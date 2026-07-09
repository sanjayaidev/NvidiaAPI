// AI Resume Generator API Endpoint
// Uses NVIDIA's AI models to generate professional resume content

export const config = {
  runtime: 'edge',
  maxDuration: 180, // 3 minutes timeout
};

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const {
      fullName,
      email,
      phone,
      address,
      dob,
      education,
      experience,
      skills,
      languages,
      certifications,
      hobbies,
      careerObjective
    } = body;

    // Validate required fields
    if (!fullName || !email || !education || education.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: fullName, email, and at least one education entry are required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build the prompt for AI
    const prompt = buildResumePrompt(body);

    // Call NVIDIA API to generate resume content using Mistral Large 3
    const aiResponse = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-large-3',
        messages: [
          {
            role: 'system',
            content: `You are a professional resume writer. Your task is to create compelling, concise, and ATS-friendly resume content. 
            Return ONLY valid JSON with the following structure:
            {
              "summary": "A powerful 3-4 sentence professional summary",
              "experience": [
                {
                  "title": "Job Title",
                  "company": "Company Name", 
                  "duration": "Date Range",
                  "description": "2-3 bullet points as a single string highlighting achievements"
                }
              ],
              "skills": "Comma-separated list of relevant skills",
              "languages": "Languages spoken",
              "certifications": "Certifications",
              "hobbies": "Hobbies and interests"
            }
            
            Make the content professional, action-oriented, and highlight achievements. Use strong verbs.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      })
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.text();
      console.error('NVIDIA API Error:', errorData);
      throw new Error('Failed to generate resume content from AI');
    }

    const aiData = await aiResponse.json();
    
    // Parse the AI response
    let resumeData;
    try {
      const aiContent = aiData.choices[0]?.message?.content || '{}';
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : aiContent;
      resumeData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback to basic data without AI enhancement
      resumeData = {
        summary: generateBasicSummary(body),
        experience: experience || [],
        skills: skills || '',
        languages: languages || '',
        certifications: certifications || '',
        hobbies: hobbies || ''
      };
    }

    // Merge user data with AI-generated content
    const finalResumeData = {
      fullName,
      email,
      phone: phone || '',
      address: address || '',
      dob: dob || '',
      education: education || [],
      experience: resumeData.experience || experience || [],
      summary: resumeData.summary || generateBasicSummary(body),
      skills: resumeData.skills || skills || '',
      languages: resumeData.languages || languages || '',
      certifications: resumeData.certifications || certifications || '',
      hobbies: resumeData.hobbies || hobbies || ''
    };

    return new Response(JSON.stringify({ 
      success: true,
      resumeData: finalResumeData
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Resume generation error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Failed to generate resume' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function buildResumePrompt(data) {
  let prompt = `Please create a professional resume based on the following information:\n\n`;
  
  prompt += `PERSONAL INFORMATION:\n`;
  prompt += `- Name: ${data.fullName}\n`;
  prompt += `- Email: ${data.email}\n`;
  if (data.phone) prompt += `- Phone: ${data.phone}\n`;
  if (data.address) prompt += `- Address: ${data.address}\n`;
  if (data.dob) prompt += `- Date of Birth: ${data.dob}\n`;
  
  prompt += `\nEDUCATION:\n`;
  (data.education || []).forEach((edu, index) => {
    prompt += `${index + 1}. ${edu.degree} from ${edu.institution}`;
    if (edu.year) prompt += ` (${edu.year})`;
    if (edu.grade) prompt += ` - Grade: ${edu.grade}`;
    prompt += `\n`;
  });
  
  if (data.experience && data.experience.length > 0) {
    prompt += `\nWORK EXPERIENCE:\n`;
    (data.experience || []).forEach((exp, index) => {
      prompt += `${index + 1}. ${exp.title} at ${exp.company}`;
      if (exp.duration) prompt += ` (${exp.duration})`;
      prompt += `\n`;
      if (exp.description) {
        prompt += `   Description: ${exp.description}\n`;
      }
    });
  }
  
  if (data.skills) {
    prompt += `\nSKILLS:\n${data.skills}\n`;
  }
  
  if (data.careerObjective) {
    prompt += `\nCAREER OBJECTIVE:\n${data.careerObjective}\n`;
  }
  
  if (data.languages) {
    prompt += `\nLANGUAGES:\n${data.languages}\n`;
  }
  
  if (data.certifications) {
    prompt += `\nCERTIFICATIONS:\n${data.certifications}\n`;
  }
  
  if (data.hobbies) {
    prompt += `\nHOBBIES:\n${data.hobbies}\n`;
  }
  
  prompt += `\nBased on this information, create a compelling professional summary (3-4 sentences) that highlights the candidate's strengths and aligns with their career objective. Also enhance the work experience descriptions with action verbs and quantifiable achievements where possible. Return the result as valid JSON.`;
  
  return prompt;
}

function generateBasicSummary(data) {
  const eduCount = data.education?.length || 0;
  const expCount = data.experience?.length || 0;
  
  let summary = `Motivated professional with ${eduCount} educational qualification${eduCount > 1 ? 's' : ''}`;
  
  if (expCount > 0) {
    summary += ` and ${expCount} work experience${expCount > 1 ? 's' : ''}`;
  }
  
  if (data.skills) {
    const skillList = data.skills.split(',').slice(0, 3).map(s => s.trim());
    if (skillList.length > 0) {
      summary += `. Skilled in ${skillList.join(', ')}`;
    }
  }
  
  if (data.careerObjective) {
    summary += `. Seeking opportunities to leverage expertise and contribute to organizational growth.`;
  } else {
    summary += `. Committed to delivering high-quality work and continuous professional development.`;
  }
  
  return summary;
}
