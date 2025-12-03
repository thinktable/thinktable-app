// API route to generate board name from user prompt using AI structured output
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  let prompt = ''
  
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    prompt = body.prompt

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
    }

    // Use structured output to generate a concise board name (ChatGPT-style naming)
    // Use more capable model and explicit instructions to avoid using prompt text directly
    const completion = await openai.beta.chat.completions.parse({
      model: 'gpt-4o', // Use more capable model for better instruction following
      messages: [
        {
          role: 'system',
          content: `You are an expert at analyzing conversation prompts and extracting their core subject matter to create concise, meaningful board titles.

YOUR TASK:
1. Read the user's prompt carefully
2. Identify the MAIN SUBJECT or TOPIC being discussed (what is this conversation really about?)
3. Ignore question words, conversational phrases, and filler words
4. Generate a 2-4 word Title Case noun phrase that represents the core subject

ANALYSIS PROCESS:
- What is the primary topic or domain? (e.g., weather, programming, cooking, travel)
- What is the specific subject within that domain? (e.g., Python, pasta recipes, Japan travel)
- Create a title that captures the essence, not the question format

EXAMPLES OF GOOD ANALYSIS:
"What's the weather in New York?" 
→ Subject: weather information for New York
→ Title: "New York Weather"

"How do I learn Python programming?"
→ Subject: Python programming education
→ Title: "Python Learning"

"What did the fox say?"
→ Subject: the fox (from the song/story)
→ Title: "The Fox"

"Can you help me plan a vacation to Japan?"
→ Subject: Japan travel planning
→ Title: "Japan Travel"

"I need recipes for vegetarian dinner"
→ Subject: vegetarian dinner recipes
→ Title: "Vegetarian Recipes"

"Explain quantum physics to me"
→ Subject: quantum physics education
→ Title: "Quantum Physics"

"Best marketing strategies for startups"
→ Subject: startup marketing strategies
→ Title: "Startup Marketing"

CRITICAL RULES:
- NEVER copy the prompt text word-for-word
- ALWAYS extract the subject/topic, not the question or statement structure
- Use proper Title Case (capitalize each major word)
- Keep it to 2-4 words maximum
- Make it a noun phrase (not a question or command)`,
        },
        {
          role: 'user',
          content: `Analyze this conversation prompt and generate a board title:

"${prompt.trim()}"

Step 1: What is the MAIN SUBJECT or TOPIC being discussed?
Step 2: What are the key words that represent this subject?
Step 3: Generate a 2-4 word Title Case noun phrase title.

Title (2-4 words, Title Case, noun phrase only):`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'board_title',
          description: 'Board title extracted from the core subject/topic of the conversation, NOT the literal prompt text',
          schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'A 2-4 word Title Case noun phrase representing the core subject/topic of the conversation. Must analyze the prompt to identify what the conversation is really about, then create a title from that subject. Examples: "New York Weather" (from "What\'s the weather in New York?"), "Python Learning" (from "How do I learn Python?"), "The Fox" (from "What did the fox say?"), "Japan Travel" (from "Can you help me plan a vacation to Japan?"). MUST NOT be the prompt text. Must extract the subject matter, not the question or statement structure.',
                minLength: 1,
                maxLength: 50,
              },
            },
            required: ['title'],
            additionalProperties: false,
          },
          strict: true, // Enforce strict schema validation
        },
      },
      temperature: 0.3, // Lower temperature for more focused, subject-oriented titles
    })

    // Extract title from structured output (most reliable method)
    const message = completion.choices[0]?.message
    const parsed = message?.parsed
    
    // Try to get title from parsed structured output
    let title = parsed?.title?.trim()
    
    // Fallback: if parsed is not available, try to parse from content (shouldn't happen with strict mode)
    if (!title && message?.content) {
      try {
        const contentParsed = JSON.parse(message.content)
        title = contentParsed?.title?.trim()
      } catch (e) {
        // Content is not JSON, ignore
      }
    }
    
    // Validate title was extracted successfully
    if (!title || title.length === 0) {
      throw new Error('Failed to extract title from structured output')
    }

    // Ensure we're returning the AI-generated title, not the prompt
    // Reject if it's an exact match (case-insensitive) or too similar
    const titleLower = title.toLowerCase().trim()
    const promptLower = prompt.toLowerCase().trim()
    const exactMatch = titleLower === promptLower
    
    console.log('🔍 Validating title:', { title, titleLower, promptLower, exactMatch })
    
    // Check if title contains most of the prompt words (too similar)
    // For short prompts, be more strict - if title has 3+ words matching prompt, it's too similar
    const promptWords = promptLower.split(/\s+/).filter(w => w.length > 1)
    const titleWords = titleLower.split(/\s+/)
    const matchingWords = promptWords.filter(pw => titleWords.some(tw => tw === pw || tw.includes(pw) || pw.includes(tw)))
    const wordMatchRatio = promptWords.length > 0 ? matchingWords.length / promptWords.length : 0
    const isTooSimilar = exactMatch || (promptWords.length > 0 && (matchingWords.length >= Math.min(3, promptWords.length) || wordMatchRatio >= 0.6))
    
    console.log('🔍 Similarity check:', { promptWords, titleWords, matchingWords, wordMatchRatio, isTooSimilar })
    
    // Reject exact matches or very similar titles - generate fallback
    if (isTooSimilar) {
      console.warn('⚠️ Warning: AI returned prompt text or too similar. Generating fallback.')
      console.warn('  Title:', title, '| Prompt:', prompt.substring(0, 50))
      
      // Generate a better title by extracting key words from prompt
      const questionWords = ['what', 'how', 'why', 'when', 'where', 'can', 'will', 'should', 'could', 'would', 'tell', 'explain', 'help', 'did', 'does', 'do', 'is', 'are']
      const conversationalWords = ['i', 'me', 'my', 'you', 'your', 'please', 'need', 'want', 'would', 'like', 'the', 'a', 'an']
      const stopWords = ['to', 'for', 'with', 'from', 'about', 'this', 'that', 'and', 'or', 'but', 'of', 'in', 'on', 'at']
      
      const words = prompt.trim()
        .split(/\s+/)
        .map(w => w.replace(/[^\w']/g, '').toLowerCase()) // Remove punctuation, lowercase
        .filter(w => {
          return w.length > 1 && 
                 !questionWords.includes(w) &&
                 !conversationalWords.includes(w) &&
                 !stopWords.includes(w)
        })
      
      if (words.length > 0) {
        // Take first 2-3 meaningful words and create title
        const keyWords = words.slice(0, 3)
        title = keyWords.map(w => {
          // Handle words with apostrophes
          const cleaned = w.replace(/'/g, '')
          return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
        }).join(' ')
        console.log('✅ Generated fallback title:', title)
      } else {
        // Last resort: use "New Conversation"
        title = 'New Conversation'
        console.warn('⚠️ Could not extract keywords, using default title')
      }
    }

    console.log('✅ AI generated board title:', title, '(from prompt:', prompt.substring(0, 50) + '...)')
    return NextResponse.json({ title })
  } catch (error: any) {
    console.error('Board name generation error:', error)
    
    // Fallback: generate title from prompt keywords (don't return prompt text directly)
    if (prompt && prompt.trim().length > 0) {
      const questionWords = ['what', 'how', 'why', 'when', 'where', 'can', 'will', 'should', 'could', 'would', 'tell', 'explain', 'help', 'did', 'does', 'do', 'is', 'are']
      const conversationalWords = ['i', 'me', 'my', 'you', 'your', 'please', 'need', 'want', 'would', 'like', 'the', 'a', 'an']
      const stopWords = ['to', 'for', 'with', 'from', 'about', 'this', 'that', 'and', 'or', 'but', 'of', 'in', 'on', 'at']
      
      const words = prompt.trim()
        .split(/\s+/)
        .map(w => w.replace(/[^\w']/g, '').toLowerCase())
        .filter(w => {
          return w.length > 1 && 
                 !questionWords.includes(w) &&
                 !conversationalWords.includes(w) &&
                 !stopWords.includes(w)
        })
      
      if (words.length > 0) {
        const keyWords = words.slice(0, 3)
        const fallbackTitle = keyWords.map(w => {
          const cleaned = w.replace(/'/g, '')
          return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
        }).join(' ')
        console.log('✅ Generated error fallback title:', fallbackTitle)
        return NextResponse.json({ title: fallbackTitle })
      }
    }
    
    return NextResponse.json({ title: 'New Conversation' })
  }
}

