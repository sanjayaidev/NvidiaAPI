// pages/api/blog/generate.js
//
// POST /api/blog/generate { topic, keywords?, cta?, format: 'plain'|'html', model? }
//
// Creates a blog generation job for long-form content (>2000 words) that may take
// longer than Vercel's default 25s timeout. Returns a jobId immediately, client
// polls GET /api/blog/:id for progress and completion.
//
// This follows the same pattern as /api/jobs/create.js but is specialized for
// blog/article generation with chunked processing if needed.

import { getSql } from '../../../lib/db';
import { getUserId, ensureUser } from '../../../lib/auth';
import { checkRateLimit } from '../../../lib/ratelimit';
import { isAllowedModel } from '../../../lib/registry';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function generateBlogSection(apiKey, model, systemPrompt, userPrompt, sectionIndex) {
  const max_tokens = 4096;
  const temperature = 0.7;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout for individual section
  
  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens,
        top_p: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error: ${response.status} - ${errText}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

export const config = { 
  runtime: 'nodejs',
  maxDuration: 60, // Vercel Pro/Enterprise supports up to 60s
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check Content-Type header
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ 
      error: 'Invalid Content-Type', 
      message: 'Content-Type must be application/json' 
    });
  }

  const sql = getSql();
  const userId = await getUserId(req);
  await ensureUser(sql, userId);

  let body;
  try {
    body = await req.json();
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return res.status(400).json({ 
      error: 'Invalid JSON body', 
      message: 'Request body must be valid JSON',
      details: err.message 
    });
  }

  const { topic, keywords = '', cta = '', format = 'plain', model = 'mistralai/mistral-large-3-675b-instruct-2512' } = body || {};

  if (!topic || topic.trim().length === 0) {
    return res.status(400).json({ error: 'Blog topic is required' });
  }

  if (!isAllowedModel(model)) {
    return res.status(403).json({ error: `Model "${model}" is not allowed` });
  }

  // Rate limit check
  const rl = await checkRateLimit(`blog:${model}`);
  if (!rl.ok) {
    return res.status(429).json({ 
      error: `Rate limit reached. Try again shortly.`, 
      retry_after_seconds: rl.retryAfterSec 
    });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'NVIDIA_API_KEY environment variable is not set' });
  }

  const primaryKeyword = keywords.split(',')[0]?.trim() || topic.split(' ')[0];
  
  // Create generic sections immediately (don't wait for AI outline)
  const sections = [
    { section: 'Introduction', prompt: `Write an engaging introduction about ${topic}`, wordCount: 300 },
    { section: 'Understanding the Basics', prompt: `Explain the fundamentals of ${topic}`, wordCount: 400 },
    { section: 'Key Benefits', prompt: `Discuss the main benefits and advantages`, wordCount: 400 },
    { section: 'Practical Tips', prompt: `Provide actionable tips and strategies`, wordCount: 500 },
    { section: 'Common Mistakes', prompt: `Highlight common pitfalls to avoid`, wordCount: 300 },
    { section: 'Advanced Techniques', prompt: `Share advanced insights for experienced readers`, wordCount: 400 },
    { section: 'Case Studies & Examples', prompt: `Provide real-world examples and case studies`, wordCount: 400 },
    { section: 'Tools & Resources', prompt: `Recommend useful tools and resources`, wordCount: 300 },
    { section: 'FAQ', prompt: `Answer frequently asked questions about ${topic}`, wordCount: 300 },
    { section: 'Conclusion', prompt: `Summarize key points and include CTA: ${cta}`, wordCount: 200 },
  ];

  try {
    // Create job record FIRST - return immediately
    const [job] = await sql`
      insert into jobs (user_id, tool, provider, status, input, output)
      values (${userId}, 'blog', 'nvidia-chat', 'running', ${JSON.stringify({
        topic,
        keywords,
        cta,
        format,
        model,
        sections,
        primaryKeyword
      })}, ${JSON.stringify({
        status: 'queued',
        totalSections: sections.length,
        completedSections: 0,
        content: '',
        titles: []
      })})
      returning id, status, output, created_at
    `;

    // Start background generation (fire-and-forget)
    const generateInBackground = async () => {
      try {
        const systemPromptPlain = `You are an AI optimized for SEO writing. Generate comprehensive, well-researched content.
        
Hard Rules:
- Keyword Density: Use "${primaryKeyword}" naturally at 1-2% density
- Snippet Optimization: Answer search queries immediately in first 100 words
- Include related entities and synonyms for semantic SEO
- Tone: Confident, authoritative, helpful
- No filler phrases like "In the ever-evolving world..." or "In conclusion..."
${cta ? `- Include CTA: "${cta}"` : ''}

Write in plain text format with clear paragraph breaks.`;

        const systemPromptHtml = `You are an AI optimized for SEO writing. Generate comprehensive, well-researched content.

Hard Rules:
- Keyword Density: Use "${primaryKeyword}" naturally at 1-2% density
- Snippet Optimization: Answer search queries immediately in first 100 words
- Include related entities and synonyms for semantic SEO
- Tone: Confident, authoritative, helpful
- No filler phrases like "In the ever-evolving world..." or "In conclusion..."
${cta ? `- Include CTA: "${cta}"` : ''}

Write in HTML format using proper tags: h1, h2, h3, h4, p, ul, ol, li, table, tr, td, th, blockquote, strong, em.
Include <img src="https://source.unsplash.com/800x600/?${encodeURIComponent(primaryKeyword)}" alt="${primaryKeyword}"> for visual breaks where appropriate.
Do NOT return full HTML document, just content tags.`;

        const systemPrompt = format === 'html' ? systemPromptHtml : systemPromptPlain;
        
        let fullContent = '';
        const generatedTitles = [];
        
        // Update status to 'generating' once we start
        await sql`
          update jobs set output = ${JSON.stringify({
            status: 'generating',
            totalSections: sections.length,
            completedSections: 0,
            content: '',
            titles: []
          })} where id = ${job.id}
        `;
        
        // Generate each section
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const sectionPrompt = `${section.prompt}. Write approximately ${section.wordCount} words. Section title: ${section.section}. Topic: ${topic}. Keywords: ${keywords}.`;
          
          try {
            const sectionContent = await generateBlogSection(
              apiKey, 
              model, 
              systemPrompt, 
              sectionPrompt,
              i
            );
            
            // Format content based on output format
            if (format === 'html') {
              fullContent += `<h2>${section.section}</h2>\n${sectionContent}\n`;
            } else {
              fullContent += `\n\n## ${section.section}\n\n${sectionContent}`;
            }
            
            // Update job progress
            await sql`
              update jobs set output = ${JSON.stringify({
                status: 'generating',
                totalSections: sections.length,
                completedSections: i + 1,
                currentSection: section.section,
                content: fullContent,
                titles: generatedTitles
              })} where id = ${job.id}
            `;
            
            // Small delay to avoid rate limits
            if (i < sections.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (sectionErr) {
            console.error(`Section ${i} failed:`, sectionErr.message);
            fullContent += `\n\n## ${section.section}\n\n[Content generation failed for this section]\n\n`;
          }
        }
        
        // Generate title options
        const titlePrompt = `Generate 3 compelling, SEO-optimized blog titles for an article about "${topic}". Include the keyword "${primaryKeyword}" naturally. Return ONLY a JSON array of 3 strings.`;
        
        try {
          const titleResponse = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: 'Return ONLY a JSON array of exactly 3 title strings.' },
                { role: 'user', content: titlePrompt }
              ],
              temperature: 0.8,
              max_tokens: 512,
              stream: false,
            }),
          });
          
          if (titleResponse.ok) {
            const titleData = await titleResponse.json();
            const titleRaw = titleData.choices?.[0]?.message?.content || '';
            try {
              const parsedTitles = JSON.parse(titleRaw);
              if (Array.isArray(parsedTitles) && parsedTitles.length >= 3) {
                generatedTitles.push(...parsedTitles.slice(0, 3));
              }
            } catch {}
          }
        } catch {}
        
        // Fallback titles
        if (generatedTitles.length < 3) {
          while (generatedTitles.length < 3) {
            generatedTitles.push(`The Ultimate Guide to ${topic}`);
          }
        }
        
        // Mark job as complete
        await sql`
          update jobs set 
            status = 'done',
            output = ${JSON.stringify({
              status: 'complete',
              totalSections: sections.length,
              completedSections: sections.length,
              content: fullContent,
              titles: generatedTitles.slice(0, 3),
              format,
              wordCount: fullContent.split(/\s+/).length
            })}
          where id = ${job.id}
        `;
        
      } catch (err) {
        console.error('Blog generation failed:', err);
        await sql`
          update jobs set 
            status = 'failed',
            output = ${JSON.stringify({ error: err.message })}
          where id = ${job.id}
        `;
      }
    };
    
    // Don't await - let it run in background
    generateInBackground();

    return res.status(201).json({ 
      jobId: job.id, 
      status: job.status,
      estimatedTime: Math.ceil(sections.length * 3) // ~3 seconds per section
    });

  } catch (err) {
    console.error('Blog generation setup failed:', err);
    return res.status(500).json({ error: 'Failed to start blog generation', details: err.message });
  }
}
