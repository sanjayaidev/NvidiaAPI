// lib/blogRunner.js
//
// advanceBlogJob(sql, job) moves a blog generation job forward by
// EXACTLY ONE STEP (one section, or the final title-generation step)
// and persists the result. It's called from two places, same as
// lib/jobRunner.js's advanceJob:
//   1. pages/api/blog/generate.js — right after creating the row,
//      best-effort, so the first response already carries progress.
//   2. pages/api/blog/[id].js (status poll) — opportunistically, so
//      polling itself drives the job forward.
//
// Why step-by-step instead of one big background loop: serverless
// functions (Edge or Node) can be frozen the instant a response is
// sent. A `generateInBackground()` call that isn't awaited has no
// guarantee it keeps running — Vercel doesn't give you idle CPU
// after the response goes out unless you use waitUntil(). Doing one
// section per invocation keeps every unit of work inside a request
// that's actually being awaited, so nothing gets silently dropped.

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

function buildSystemPrompt({ format, primaryKeyword, cta, language = 'en' }) {
  const languageInstruction = language !== 'en' ? `\n\nIMPORTANT: Write ALL content in ${language} language. All headings, paragraphs, lists, and text must be entirely in ${language}. This is critical.` : '';
  
  const formatInstruction = format === 'html' 
    ? `\n\nFORMAT REQUIREMENT: Return content in HTML format using proper semantic tags:\n- Use <h2>, <h3>, <h4> for section headings (NOT h1, as titles use h1)\n- Use <p> for paragraphs\n- Use <ul>, <ol>, <li> for lists\n- Use <table>, <tr>, <td>, <th> for tables\n- Use <blockquote> for quotes\n- Use <strong> and <em> for emphasis\n- Use <img src="https://source.unsplash.com/800x600/?${encodeURIComponent(primaryKeyword)}" alt="${primaryKeyword}"> for images where appropriate\n- Do NOT return a full HTML document, only the content tags inside the body.`
    : `\n\nFORMAT REQUIREMENT: Return content in Markdown format using:\n- Use ## for H2 headings, ### for H3, #### for H4\n- Use **bold** and *italic* for emphasis\n- Use - or * for bullet lists, 1. 2. 3. for numbered lists\n- Use > for blockquotes\n- Use | col | col | for tables\n- Use ![alt](url) for images`;

  const rules = `Hard Rules:
- Keyword Density: Use "${primaryKeyword}" naturally at 1-2% density
- Snippet Optimization: Answer search queries immediately in first 100 words
- Include related entities and synonyms for semantic SEO
- Tone: Confident, authoritative, helpful
- No filler phrases like "In the ever-evolving world..." or "In conclusion..."
${cta ? `- Include CTA: "${cta}"` : ''}${languageInstruction}${formatInstruction}`;

  if (format === 'html') {
    return `You are an AI optimized for SEO writing. Generate comprehensive, well-researched content.${languageInstruction}

${rules}

Write in HTML format using proper tags as specified above.`;
  }

  return `You are an AI optimized for SEO writing. Generate comprehensive, well-researched content.${languageInstruction}

${rules}

Write in Markdown format as specified above.`;
}

async function callNvidiaChat(apiKey, model, systemPrompt, userPrompt, { temperature = 0.7, max_tokens = 4096 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

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
          { role: 'user', content: userPrompt },
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

/**
 * Advance a blog job by exactly one step. Safe to call repeatedly —
 * it's a no-op once the job is 'done' or 'failed'.
 *
 * @param {ReturnType<typeof import('./db').getSql>} sql
 * @param {object} job - full row from `jobs` table (input/output already parsed or JSON strings)
 */
export async function advanceBlogJob(sql, job) {
  if (job.status === 'done' || job.status === 'failed') return job;

  const input = typeof job.input === 'string' ? JSON.parse(job.input) : job.input;
  const output = typeof job.output === 'string' ? JSON.parse(job.output) : job.output || {};

  const { topic, keywords, cta, language = 'en', format, model, sections, primaryKeyword } = input;
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    return persist(sql, job.id, 'failed', { error: 'NVIDIA_API_KEY environment variable is not set' });
  }

  const completedSections = output.completedSections || 0;

  try {
    // Step: generate the next section
    if (completedSections < sections.length) {
      const section = sections[completedSections];
      const systemPrompt = buildSystemPrompt({ format, primaryKeyword, cta, language });
      const sectionPrompt = `${section.prompt}. Write approximately ${section.wordCount} words. Section title: ${section.section}. Topic: ${topic}. Keywords: ${keywords}. Language: ${language}. IMPORTANT: Return ONLY the content for this section, do NOT repeat the section heading in your response as it will be added automatically.`;

      let sectionContent;
      try {
        sectionContent = await callNvidiaChat(apiKey, model, systemPrompt, sectionPrompt);
        // Clean up any markdown code blocks that might wrap the content
        sectionContent = sectionContent.replace(/^```html\n?/i, '').replace(/^```markdown\n?/i, '').replace(/```$/g, '').trim();
      } catch (sectionErr) {
        console.error(`Section ${completedSections} failed:`, sectionErr.message);
        // Fail the whole job immediately instead of quietly stamping
        // "[Content generation failed for this section]" into all ten
        // sections one poll at a time. If the model/key is bad, every
        // remaining section will fail the exact same way — better to
        // surface the real NVIDIA error now than burn through the rest
        // of the sections to find out.
        return persist(sql, job.id, 'failed', {
          error: `Section "${section.section}" failed: ${sectionErr.message}`,
          totalSections: sections.length,
          completedSections,
          content: output.content || '',
          titles: output.titles || [],
        });
      }

      const priorContent = output.content || '';
      const content = format === 'html'
        ? `${priorContent}<h2>${section.section}</h2>\n${sectionContent}\n`
        : `${priorContent}\n\n## ${section.section}\n\n${sectionContent}`;

      const nextCompleted = completedSections + 1;
      const isLastSection = nextCompleted >= sections.length;

      return persist(sql, job.id, isLastSection ? 'running' : 'running', {
        status: 'generating',
        totalSections: sections.length,
        completedSections: nextCompleted,
        currentSection: section.section,
        content,
        titles: output.titles || [],
      });
    }

    // Step: generate titles (runs once, after all sections are done)
    if (!output.titles || output.titles.length === 0) {
      const generatedTitles = [];
      const titlePrompt = `Generate exactly 3 compelling, SEO-optimized, DISTINCT blog titles for an article about "${topic}". Include the keyword "${primaryKeyword}" naturally. All titles must be in ${language} language. Return ONLY a JSON array of exactly 3 different title strings. Each title should have a unique angle or approach.`;

      try {
        const titleRaw = await callNvidiaChat(
          apiKey,
          model,
          `You MUST return ONLY a valid JSON array with exactly 3 different title strings in ${language} language. No other text, no explanation, just the JSON array.`,
          titlePrompt,
          { temperature: 0.9, max_tokens: 512 }
        );
        const parsedTitles = JSON.parse(titleRaw);
        if (Array.isArray(parsedTitles) && parsedTitles.length >= 3) {
          generatedTitles.push(...parsedTitles.slice(0, 3));
        }
      } catch {
        // fall through to fallback titles below
      }

      while (generatedTitles.length < 3) {
        generatedTitles.push(`The Ultimate Guide to ${topic}`);
      }

      const fullContent = output.content || '';

      return persist(sql, job.id, 'done', {
        status: 'complete',
        totalSections: sections.length,
        completedSections: sections.length,
        content: fullContent,
        titles: generatedTitles.slice(0, 3),
        format,
        wordCount: fullContent.split(/\s+/).length,
      });
    }

    // Nothing left to do (shouldn't normally get here) — mark done.
    return persist(sql, job.id, 'done', { ...output, status: 'complete' });
  } catch (err) {
    console.error('Blog generation step failed:', err);
    return persist(sql, job.id, 'failed', { error: err.message });
  }
}

async function persist(sql, jobId, status, output) {
  const [saved] = await sql`
    update jobs set status = ${status}, output = ${JSON.stringify(output)}
    where id = ${jobId}
    returning id, status, input, output, created_at
  `;
  return saved;
}
