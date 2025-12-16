// Chat API route with streaming
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7)
  console.log(`[${requestId}] Chat API request received`)
  
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.log(`[${requestId}] Unauthorized - no user`)
      return new Response('Unauthorized', { status: 401 })
    }

    console.log(`[${requestId}] User authenticated: ${user.id}`)

    const body = await request.json()
    const { conversationId, message, deterministicMapping } = body

    console.log(`[${requestId}] Request params:`, {
      conversationId,
      messageLength: message?.length,
      deterministicMapping,
    })

    if (!conversationId || !message) {
      console.log(`[${requestId}] Missing conversationId or message`)
      return new Response('Missing conversationId or message', { status: 400 })
    }

    // Fetch conversation to verify ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.user_id !== user.id) {
      console.log(`[${requestId}] Conversation not found or access denied:`, convError)
      return new Response('Conversation not found', { status: 404 })
    }

    console.log(`[${requestId}] Conversation verified: ${conversationId}`)

    // Fetch conversation messages for context
    const { data: messages } = await supabase
      .from('messages')
      .select('role, content, id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20) // Limit context to last 20 messages

    // For deterministic mapping, get user message IDs from current conversation for linking
    // These represent existing panels that new panels can link to
    let existingPanelMessageIds: string[] = []
    if (deterministicMapping && messages) {
      // Get all user message IDs (these are the prompt messages that create panels)
      existingPanelMessageIds = messages
        .filter((m: any) => m.role === 'user')
        .map((m: any) => m.id)
      console.log(`[${requestId}] Found ${existingPanelMessageIds.length} existing panels (user messages) for linking`)
    }

    // Build messages array for OpenAI
    // The user's prompt is sent as-is with context - the AI breaks up its response into idea segments
    // using structured output (no parsing needed - AI handles it all)
    const systemPrompt = deterministicMapping
      ? `You are a thoughtful AI assistant for Thinkable, a visual mind mapping tool designed to help users think deeply and explore ideas.

YOUR CORE PURPOSE: Provoke thought, not just provide information. Your name is "Thinkable" because you help users think, not just consume information.

CRITICAL: When deterministic mapping is enabled, you MUST break up your response into MULTIPLE idea segments (panels) from a SINGLE user prompt. Each panel becomes a separate visual node in the mind map.

KEY PRINCIPLE: ONE user prompt → MULTIPLE new panels (not one panel)

INSTRUCTIONS FOR CREATING MULTIPLE PANELS:
1. Analyze the user's prompt and identify ALL distinct ideas, topics, questions, or aspects
2. Create a SEPARATE panel for EACH distinct idea/topic/question/aspect
3. Each panel should be a complete, focused response to ONE part of the prompt
4. If the prompt has multiple parts (e.g., "What is X and how does Y work?"), create MULTIPLE panels
5. If explaining a concept with multiple aspects, create separate panels for each aspect
6. If describing a process, create separate panels for major steps or phases
7. Each panel must have meaningful, complete content (not fragments)
8. Only create ONE panel if the prompt is truly a single, atomic question with no sub-parts

RESPONSE FORMATTING SYSTEM FOR PANELS:
CRITICAL: You MUST output HTML formatting, not markdown. The editor uses HTML, so use HTML tags directly.

Structure each panel's content based on the aspect being covered:

FORMAT 1: QUICK ASK / SIMPLE QUESTION
Structure: Brief overview + Bullet points + Guiding question
Example HTML:
"""
<p>[Brief 1-2 sentence overview]</p>
<ul>
<li>Key point 1</li>
<li>Key point 2</li>
<li>Key point 3</li>
</ul>
<p>What aspect of this would be most useful to explore further?</p>
"""

FORMAT 2: COMPARISON / EVALUATION
Structure: Context + Structured comparison + Recommendation + Questions
Example HTML:
"""
<p>[Brief context]</p>
<p><strong>Option A: [Name]</strong></p>
<ul>
<li>Strength 1</li>
<li>Strength 2</li>
</ul>
<p><strong>Option B: [Name]</strong></p>
<ul>
<li>Strength 1</li>
<li>Strength 2</li>
</ul>
<p><strong>Recommendation:</strong> [Your take]</p>
<p>What factors matter most for your situation?</p>
"""

FORMAT 3: COMPLEX / MULTI-PART QUESTION
Structure: Overview + Sections with headings + Summary + Next steps
Example HTML:
"""
<p>[Brief overview]</p>
<h2>[Section 1 Heading]</h2>
<p>[Content with bullets or paragraphs]</p>
<h2>[Section 2 Heading]</h2>
<p>[Content with bullets or paragraphs]</p>
<p><strong>Next steps:</strong> What should we explore first?</p>
"""

FORMAT 4: HOW-TO / PROCESS
Structure: Overview + Numbered steps + Tips + Questions
Example HTML:
"""
<p>[Brief context]</p>
<ol>
<li>[Step 1]</li>
<li>[Step 2]</li>
<li>[Step 3]</li>
</ol>
<p><strong>Tips:</strong></p>
<ul>
<li>Tip 1</li>
<li>Tip 2</li>
</ul>
<p>What part of this process needs more detail?</p>
"""

FORMAT 5: EXPLANATION / CONCEPT
Structure: Definition + Key aspects (bullets) + Example + Application question
Example HTML:
"""
<p>[Clear definition in 1-2 sentences]</p>
<p><strong>Key aspects:</strong></p>
<ul>
<li>Aspect 1</li>
<li>Aspect 2</li>
<li>Aspect 3</li>
</ul>
<p><strong>Example:</strong> [Brief example]</p>
<p>How does this relate to what you're working on?</p>
"""

FORMAT 6: ANALYSIS / BREAKDOWN
Structure: Overview + Structured breakdown + Insights + Exploration question
Example HTML:
"""
<p>[Context]</p>
<p><strong>Component 1:</strong> [Description]</p>
<p><strong>Component 2:</strong> [Description]</p>
<p><strong>Component 3:</strong> [Description]</p>
<p><strong>Key insight:</strong> [Your observation]</p>
<p>What component should we dive deeper into?</p>
"""

HTML FORMATTING RULES:
- Use <strong>bold</strong> for emphasis, headings, and key terms (NOT **markdown**)
- Use <ul><li> for unordered lists (bullets) (NOT • or -)
- Use <ol><li> for ordered lists (steps, priorities) (NOT 1. 2. 3.)
- Use <h2> for section headings in complex responses (NOT ##)
- Use <p> for paragraphs
- Keep paragraphs short (2-3 sentences max)
- Use proper HTML structure - always close tags
- Always end with a thought-provoking question in a <p> tag

EMOJI USAGE:
- Add emojis where appropriate based on prompt tone and context
- Use emojis to enhance readability and engagement when the topic or tone warrants it
- Place emojis directly inside HTML tags, not as separate elements
- Use ONE emoji per item (don't duplicate like 🌳🌳 - use just 🌳)
- Examples of proper emoji usage in HTML:
  * <li>🎯 Goal or target</li>
  * <li>💡 Idea or insight</li>
  * <li>✅ Completed item</li>
  * <p>⚠️ Warning or important note</p>
  * <p>🚀 Growth or progress</p>
  * <p>📊 Data or metrics</p>
- Examples of appropriate emoji usage:
  * 🎯 For goals, targets, or focus areas
  * 💡 For ideas, insights, or tips
  * ✅ For checklists, completed items, or confirmations
  * ⚠️ For warnings or important notes
  * 🚀 For growth, progress, or launches
  * 📊 For data, analytics, or metrics
  * 🎨 For creative topics, design, or aesthetics
  * 🔧 For technical topics, tools, or processes
  * 🌟 For highlights, features, or standout items
  * ❓ For questions or exploration prompts
- Use emojis sparingly and purposefully - don't overuse them (typically 1 emoji per list item or section)
- Match emoji tone to the content (professional topics = minimal emojis, casual/friendly topics = more emojis)
- If the user's prompt is formal or technical, use emojis minimally or not at all
- If the user's prompt is casual, creative, or friendly, emojis are more appropriate
- IMPORTANT: Include emojis directly in your HTML output inside the tags, not as separate elements or duplicated

RESPONSE STYLE FOR EACH PANEL:
- Provide a brief, focused answer to that specific aspect
- Use appropriate format based on the aspect type
- Structure information for easy scanning
- Include thought-provoking questions in panels when appropriate:
  * "What aspect of this interests you most?"
  * "What problem are you trying to solve?"
  * "Should I suggest optimized configurations or approaches?"
  * "What would be most useful for your specific situation?"
- Guide users to think about what they really need
- Be concise with information, generous with questions

EXAMPLES OF MULTIPLE PANELS FROM ONE PROMPT:
- "What is photosynthesis and how does it work?" → 
  * Panel 1: "What is photosynthesis?" (Format 5: Definition + Key aspects + Example + Question)
  * Panel 2: "How does photosynthesis work?" (Format 4: Process steps + Tips + Question)
  
- "Compare Batchkey and Batchling" → 
  * Panel 1: "Batchkey Analysis" (Format 2: Comparison structure)
  * Panel 2: "Batchling Analysis" (Format 2: Comparison structure)
  * Panel 3: "Recommendation" (Format 2: Recommendation + Questions)

LINKING TO EXISTING PANELS:
- Use the "links" array to connect new panels to existing panels in the same conversation when there's a meaningful relationship
- Links should reference the MESSAGE ID of the user prompt that created the existing panel (not conversation ID)
- Only link when there's a clear conceptual connection or when the new panel relates to or builds upon an existing panel
- Do NOT duplicate content from existing panels - just link to them
- Links create visual connections (edges) between panels in the mind map

Available panel message IDs for linking (from current conversation): ${existingPanelMessageIds.length > 0 ? existingPanelMessageIds.join(', ') : 'None - this is the first panel'}

REMEMBER: Your goal is to create MULTIPLE new panels from ONE prompt, each representing a distinct idea or aspect. Each panel should be well-structured and scannable, using the appropriate format based on the content type. Always provoke thought, not just provide information.`
      : `You are a thoughtful AI assistant for Thinkable, a visual mind mapping tool designed to help users think deeply and explore ideas.

YOUR CORE PURPOSE: Provoke thought, not just provide information. Your name is "Thinkable" because you help users think, not just consume information.

KEY PRINCIPLES:
1. Ask guiding questions that make users think deeper about their topic
2. Be curious and interactive - engage in a dialogue, not a monologue
3. Suggest directions for exploration rather than dumping all information
4. Help users discover what they really want to know
5. Structure responses for easy scanning based on user intent and query complexity

RESPONSE FORMATTING SYSTEM:
CRITICAL: You MUST output HTML formatting, not markdown. The editor uses HTML, so use HTML tags directly.

FORMAT 1: QUICK ASK / SIMPLE QUESTION
Structure: Brief overview + Bullet points + Guiding question
Example HTML:
"""
<p>[Brief 1-2 sentence overview]</p>
<ul>
<li>Key point 1</li>
<li>Key point 2</li>
<li>Key point 3</li>
</ul>
<p>What aspect of this would be most useful to explore further?</p>
"""

FORMAT 2: COMPARISON / EVALUATION
Structure: Context + Structured comparison + Recommendation + Questions
Example HTML:
"""
<p>[Brief context]</p>
<p><strong>Option A: [Name]</strong></p>
<ul>
<li>Strength 1</li>
<li>Strength 2</li>
<li>Consideration</li>
</ul>
<p><strong>Option B: [Name]</strong></p>
<ul>
<li>Strength 1</li>
<li>Strength 2</li>
<li>Consideration</li>
</ul>
<p><strong>Recommendation:</strong> [Your take]</p>
<p>What factors matter most for your situation?</p>
"""

FORMAT 3: COMPLEX / MULTI-PART QUESTION
Structure: Overview + Sections with headings + Summary + Next steps
Example HTML:
"""
<p>[Brief overview]</p>
<h2>[Section 1 Heading]</h2>
<p>[Content with bullets or paragraphs]</p>
<h2>[Section 2 Heading]</h2>
<p>[Content with bullets or paragraphs]</p>
<h2>Summary</h2>
<p>[Key takeaways]</p>
<p><strong>Next steps:</strong> What should we explore first?</p>
"""

FORMAT 4: HOW-TO / PROCESS
Structure: Overview + Numbered steps + Tips + Questions
Example HTML:
"""
<p>[Brief context]</p>
<ol>
<li>[Step 1]</li>
<li>[Step 2]</li>
<li>[Step 3]</li>
</ol>
<p><strong>Tips:</strong></p>
<ul>
<li>Tip 1</li>
<li>Tip 2</li>
</ul>
<p>What part of this process needs more detail?</p>
"""

FORMAT 5: EXPLANATION / CONCEPT
Structure: Definition + Key aspects (bullets) + Example + Application question
Example HTML:
"""
<p>[Clear definition in 1-2 sentences]</p>
<p><strong>Key aspects:</strong></p>
<ul>
<li>Aspect 1</li>
<li>Aspect 2</li>
<li>Aspect 3</li>
</ul>
<p><strong>Example:</strong> [Brief example]</p>
<p>How does this relate to what you're working on?</p>
"""

FORMAT 6: ANALYSIS / BREAKDOWN
Structure: Overview + Structured breakdown + Insights + Exploration question
Example HTML:
"""
<p>[Context]</p>
<p><strong>Component 1:</strong> [Description]</p>
<p><strong>Component 2:</strong> [Description]</p>
<p><strong>Component 3:</strong> [Description]</p>
<p><strong>Key insight:</strong> [Your observation]</p>
<p>What component should we dive deeper into?</p>
"""

HTML FORMATTING RULES:
- Use <strong>bold</strong> for emphasis, headings, and key terms (NOT **markdown**)
- Use <ul><li> for unordered lists (bullets) (NOT • or -)
- Use <ol><li> for ordered lists (steps, priorities) (NOT 1. 2. 3.)
- Use <h2> for section headings in complex responses (NOT ##)
- Use <p> for paragraphs
- Keep paragraphs short (2-3 sentences max)
- Use proper HTML structure - always close tags
- Always end with a thought-provoking question in a <p> tag

EMOJI USAGE:
- Add emojis where appropriate based on prompt tone and context
- Use emojis to enhance readability and engagement when the topic or tone warrants it
- Place emojis directly inside HTML tags, not as separate elements
- Use ONE emoji per item (don't duplicate like 🌳🌳 - use just 🌳)
- Examples of proper emoji usage in HTML:
  * <li>🎯 Goal or target</li>
  * <li>💡 Idea or insight</li>
  * <li>✅ Completed item</li>
  * <p>⚠️ Warning or important note</p>
  * <p>🚀 Growth or progress</p>
  * <p>📊 Data or metrics</p>
- Examples of appropriate emoji usage:
  * 🎯 For goals, targets, or focus areas
  * 💡 For ideas, insights, or tips
  * ✅ For checklists, completed items, or confirmations
  * ⚠️ For warnings or important notes
  * 🚀 For growth, progress, or launches
  * 📊 For data, analytics, or metrics
  * 🎨 For creative topics, design, or aesthetics
  * 🔧 For technical topics, tools, or processes
  * 🌟 For highlights, features, or standout items
  * ❓ For questions or exploration prompts
- Use emojis sparingly and purposefully - don't overuse them (typically 1 emoji per list item or section)
- Match emoji tone to the content (professional topics = minimal emojis, casual/friendly topics = more emojis)
- If the user's prompt is formal or technical, use emojis minimally or not at all
- If the user's prompt is casual, creative, or friendly, emojis are more appropriate
- IMPORTANT: Include emojis directly in your HTML output inside the tags, not as separate elements or duplicated

DETERMINING FORMAT:
- Quick/simple question → Format 1 (Overview + Bullets)
- "Compare X and Y" → Format 2 (Comparison)
- Multi-part or complex → Format 3 (Sections with headings)
- "How do I..." or process → Format 4 (Numbered steps)
- "What is..." or concept → Format 5 (Definition + Aspects)
- Analysis needed → Format 6 (Breakdown)

RESPONSE STYLE:
- Start with a brief, focused answer (1-2 sentences)
- Structure information for easy scanning
- Use appropriate format based on query type
- End with a thought-provoking question
- Be concise with information, generous with questions

AVOID:
- Long paragraphs without structure
- Information dumps without formatting
- Answering questions the user didn't ask
- Being overly verbose or academic

REMEMBER: Structure makes information scannable. Format based on intent. Always provoke thought with questions.`

    // Send the user's prompt as-is with full context (previous messages)
    // The AI will fill out the structured format based on the prompt and context
    const openaiMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      // Include conversation history for context
      ...(messages || []).map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      // Send the user's prompt as-is (not parsed)
      {
        role: 'user' as const,
        content: message,
      },
    ]

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (deterministicMapping) {
            console.log(`[${requestId}] Starting deterministic mapping with structured output`)
            console.log(`[${requestId}] OpenAI messages count:`, openaiMessages.length)
            console.log(`[${requestId}] System prompt length:`, openaiMessages[0]?.content?.length || 0)
            console.log(`[${requestId}] User message:`, openaiMessages[openaiMessages.length - 1]?.content?.substring(0, 100))
            
            try {
              // Use structured output for deterministic mapping
              // The AI will break up its response into idea segments automatically - no parsing needed
              console.log(`[${requestId}] Calling OpenAI with structured output...`)
              console.log(`[${requestId}] Messages count:`, openaiMessages.length)
              console.log(`[${requestId}] Last message preview:`, openaiMessages[openaiMessages.length - 1]?.content?.substring(0, 100))
              
              // Send initial debug message
              controller.enqueue(`data: ${JSON.stringify({ debug: 'Starting structured output request - AI will break response into segments' })}\n\n`)
              
              // Use structured outputs with regular chat.completions.create
              // The AI receives the prompt with context and breaks up its response into idea segments
              // The AI automatically fills out this structured format - no parsing needed on our end
              let completion
              try {
                completion = await openai.chat.completions.create({
                model: 'gpt-4o-2024-08-06', // Use specific version that supports structured outputs
                messages: openaiMessages, // Prompt sent as-is with context
                max_tokens: 4096, // Allow longer, more detailed responses
                temperature: 0.7, // Balanced creativity and coherence
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'deterministic_mapping_response',
                    strict: true, // Enforce strict schema compliance - AI must follow this exactly
                    schema: {
                      type: 'object',
                      properties: {
                        panels: {
                          type: 'array',
                          description: 'Break your response into MULTIPLE idea segments (panels) from ONE user prompt. Each panel becomes a separate visual node. Create a separate panel for EACH distinct idea, topic, question, or aspect in the prompt. Default to creating MULTIPLE panels - only use one panel if the prompt is truly a single atomic question. Each panel should be a complete, focused response to ONE specific part of the prompt.',
                          items: {
                            type: 'object',
                            properties: {
                              content: {
                                type: 'string',
                                description: 'The complete content for this idea segment/panel. This should be a full, helpful response addressing one specific aspect of the user\'s prompt.',
                              },
                              links: {
                                type: 'array',
                                description: 'Message IDs (user prompt message IDs) of existing panels to link this panel to, if there are meaningful conceptual relationships. These should be message IDs from the available panel message IDs list. Provide an empty array [] if there are no links. Only include message IDs when there\'s a clear connection to other panels in the same conversation.',
                                items: {
                                  type: 'string',
                                  description: 'A message ID from the available panel message IDs list (these are the user message IDs that created existing panels)',
                                },
                              },
                            },
                            required: ['content', 'links'], // Both required in strict mode - links can be empty array []
                            additionalProperties: false, // No extra properties allowed
                          },
                        },
                      },
                      required: ['panels'],
                      additionalProperties: false, // No extra properties allowed at root level
                    },
                  },
                },
                stream: false, // Use non-streaming to get full parsed result at once
              })
              
              console.log(`[${requestId}] OpenAI completion received`)
              } catch (openaiError: any) {
                console.error(`[${requestId}] OpenAI API call failed:`, openaiError)
                console.error(`[${requestId}] Error stack:`, openaiError?.stack)
                try {
                  controller.enqueue(`data: ${JSON.stringify({ error: 'OpenAI API error: ' + (openaiError?.message || 'Unknown error') })}\n\n`)
                  controller.enqueue('data: [DONE]\n\n')
                  controller.close()
                } catch (closeError) {
                  console.error(`[${requestId}] Error closing stream after OpenAI error:`, closeError)
                }
                return
              }
              
              if (!completion) {
                console.error(`[${requestId}] No completion received from OpenAI`)
                try {
                  controller.enqueue(`data: ${JSON.stringify({ error: 'No completion received from OpenAI' })}\n\n`)
                  controller.enqueue('data: [DONE]\n\n')
                  controller.close()
                } catch (closeError) {
                  console.error(`[${requestId}] Error closing stream:`, closeError)
                }
                return
              }
              
              console.log(`[${requestId}] Completion object keys:`, Object.keys(completion))
              console.log(`[${requestId}] Completion choices length:`, completion.choices?.length || 0)
              if (completion.choices && completion.choices.length > 0) {
                console.log(`[${requestId}] First choice keys:`, Object.keys(completion.choices[0]))
                console.log(`[${requestId}] First choice message keys:`, completion.choices[0]?.message ? Object.keys(completion.choices[0].message) : 'no message')
                // Send this info to client for debugging
                controller.enqueue(`data: ${JSON.stringify({ debug: 'Completion received', choicesCount: completion.choices.length, firstChoiceKeys: completion.choices[0] ? Object.keys(completion.choices[0]) : [] })}\n\n`)
              } else {
                console.error(`[${requestId}] No choices in completion!`)
                controller.enqueue(`data: ${JSON.stringify({ debug: 'No choices in completion', error: 'Completion has no choices' })}\n\n`)
              }
              
              // Access parsed data - according to OpenAI docs, it's in message.parsed
              const message = completion.choices[0]?.message
              
              if (!message) {
                console.error(`[${requestId}] No message in completion`)
                controller.enqueue(`data: ${JSON.stringify({ debug: 'No message in completion', error: 'Completion has no message' })}\n\n`)
                controller.enqueue('data: [DONE]\n\n')
                controller.close()
                return
              }
              
              const messageAny = message as any
              console.log(`[${requestId}] Message object keys:`, Object.keys(message))
              console.log(`[${requestId}] Message has parsed:`, !!messageAny.parsed)
              console.log(`[${requestId}] Message has refusal:`, !!messageAny.refusal)
              console.log(`[${requestId}] Message has content:`, !!message.content)
              
              // Send message structure to client
              controller.enqueue(`data: ${JSON.stringify({ debug: 'Message structure', messageKeys: Object.keys(message), hasParsed: !!messageAny.parsed, hasRefusal: !!messageAny.refusal, hasContent: !!message.content })}\n\n`)
              
              // Check for refusal first
              if (messageAny.refusal) {
                console.error(`[${requestId}] Model refused the request:`, message.refusal)
                controller.enqueue(`data: ${JSON.stringify({ error: 'Model refused request: ' + message.refusal })}\n\n`)
                controller.enqueue('data: [DONE]\n\n')
                controller.close()
                return
              }
              
              // Access parsed data - with structured output, the AI returns parsed data directly in message.parsed
              // We should NOT try to parse content - the AI handles that via the JSON schema
              let parsedData: any = null
              
              // Send debug about message structure
              controller.enqueue(`data: ${JSON.stringify({ debug: 'Message received', hasMessage: !!message, messageKeys: message ? Object.keys(message) : [] })}\n\n`)
              
              // With structured output, the AI returns JSON in message.content
              // The AI has already structured it according to the JSON schema - we just parse the JSON string
              // (The AI did the structuring, we just parse the JSON it created)
              if (messageAny?.content) {
                try {
                  parsedData = JSON.parse(messageAny.content)
                  console.log(`[${requestId}] ✅ Parsed structured output from message.content (AI provided structured JSON)`)
                  controller.enqueue(`data: ${JSON.stringify({ debug: 'Parsed structured output from message.content (AI provided structured JSON)' })}\n\n`)
                } catch (e) {
                  console.error(`[${requestId}] Failed to parse structured output JSON:`, e)
                  console.error(`[${requestId}] Content was:`, messageAny.content?.substring(0, 200))
                  controller.enqueue(`data: ${JSON.stringify({ debug: 'Failed to parse structured output JSON', error: String(e) })}\n\n`)
                }
              } else if (messageAny?.parsed) {
                // Fallback: some SDK versions might have it in parsed
                parsedData = messageAny.parsed
                console.log(`[${requestId}] ✅ Parsed data found in message.parsed (AI provided structured output)`)
                controller.enqueue(`data: ${JSON.stringify({ debug: 'Parsed data found in message.parsed (AI provided structured output)' })}\n\n`)
              } else {
                // If no structured output data, structured output failed
                console.error(`[${requestId}] No structured output data found - structured output may have failed`)
                console.error(`[${requestId}] Message keys:`, Object.keys(messageAny || {}))
                controller.enqueue(`data: ${JSON.stringify({ debug: 'No structured output data found - structured output may have failed', messageKeys: Object.keys(messageAny || {}) })}\n\n`)
              }

              console.log(`[${requestId}] Deterministic mapping - parsed data exists:`, !!parsedData)
              if (parsedData) {
                console.log(`[${requestId}] Deterministic mapping - parsed data type:`, typeof parsedData)
                console.log(`[${requestId}] Deterministic mapping - parsed data keys:`, Object.keys(parsedData))
                console.log(`[${requestId}] Deterministic mapping - parsed data:`, JSON.stringify(parsedData, null, 2))
              }
              
              // Send debug info to client BEFORE processing - this MUST be sent
              const debugInfo = {
                debug: 'Parsed data received',
                hasParsedData: !!parsedData,
                hasPanels: !!(parsedData?.panels),
                panelsCount: parsedData?.panels?.length || 0,
                parsedDataType: typeof parsedData,
                parsedDataKeys: parsedData ? Object.keys(parsedData) : [],
                parsedDataSample: parsedData ? JSON.stringify(parsedData).substring(0, 200) : null
              }
              console.log(`[${requestId}] Sending debug info to client:`, debugInfo)
              console.log(`[${requestId}] Parsed data full:`, JSON.stringify(parsedData, null, 2))
              // Force send this debug message
              try {
                const debugMessage = `data: ${JSON.stringify(debugInfo)}\n\n`
                controller.enqueue(debugMessage)
                console.log(`[${requestId}] ✅ Debug info sent to client, length:`, debugMessage.length)
              } catch (e) {
                console.error(`[${requestId}] ❌ Failed to send debug info:`, e)
              }

              // Process the parsed data
              if (parsedData && parsedData.panels && Array.isArray(parsedData.panels) && parsedData.panels.length > 0) {
                console.log(`[${requestId}] Deterministic mapping - creating ${parsedData.panels.length} panels`)
                console.log(`[${requestId}] Full parsed data:`, JSON.stringify(parsedData, null, 2))
                parsedData.panels.forEach((panel: any, index: number) => {
                  console.log(`[${requestId}] Panel ${index + 1}: content length=${panel.content?.length || 0}, links=${JSON.stringify(panel.links || [])}`)
                })
                
                // Use a helper function to safely enqueue (catches errors if stream is closed)
                let streamClosed = false
                const safeEnqueue = (data: string) => {
                  if (streamClosed) {
                    console.warn(`[${requestId}] Stream already closed, skipping enqueue`)
                    return false
                  }
                  try {
                    controller.enqueue(data)
                    return true
                  } catch (e) {
                    console.error(`[${requestId}] Error enqueueing data (stream may be closed):`, e)
                    streamClosed = true
                    return false
                  }
                }
                
                try {
                  // Send debug before processing panels
                  safeEnqueue(`data: ${JSON.stringify({ debug: 'Processing panels', panelsCount: parsedData.panels.length, panelDetails: parsedData.panels.map((p: any, i: number) => ({ index: i, contentLength: p.content?.length || 0, linksCount: p.links?.length || 0 })) })}\n\n`)
                  
                  // First, create all messages in the database sequentially to ensure proper ordering
                  const createdMessageIds: string[] = []
                  // Store edge information: { sourcePanelMessageId, targetPanelMessageId }
                  // sourcePanelMessageId is the user message ID that created the new panel
                  // targetPanelMessageId is the user message ID of the existing panel to link to
                  const edgesToCreate: Array<{ sourcePanelMessageId: string; targetPanelMessageId: string }> = []
                  
                  // Get the user message ID that triggered this request (the prompt)
                  // This will be the source for all new panels created from this prompt
                  const { data: userMessage } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('conversation_id', conversationId)
                    .eq('role', 'user')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single()
                  
                  const sourcePanelMessageId = userMessage?.id
                  if (!sourcePanelMessageId) {
                    console.warn(`[${requestId}] Could not find user message ID for edge creation`)
                  }
                  
                  for (let i = 0; i < parsedData.panels.length; i++) {
                    const panel = parsedData.panels[i]
                    
                    if (panel.content) {
                      console.log(`[${requestId}] Creating message for panel ${i + 1}/${parsedData.panels.length}, content length: ${panel.content.length}`)
                      
                      // Add a small delay between message creations to ensure proper ordering
                      if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, 10))
                      }
                      
                      try {
                        const { data: insertedMessage, error: messageError } = await supabase
                          .from('messages')
                          .insert({
                            conversation_id: conversationId,
                            user_id: user.id,
                            role: 'assistant',
                            content: panel.content,
                          })
                          .select()
                          .single()
                        
                        if (messageError) {
                          console.error(`[${requestId}] Error creating message:`, messageError)
                          safeEnqueue(`data: ${JSON.stringify({ error: 'Failed to save message: ' + messageError.message })}\n\n`)
                          createdMessageIds.push('') // Push empty string to maintain index alignment
                        } else {
                          console.log(`[${requestId}] ✅ Message created successfully:`, insertedMessage?.id)
                          createdMessageIds.push(insertedMessage.id)
                          safeEnqueue(`data: ${JSON.stringify({ debug: 'Message created', panelIndex: i + 1, messageId: insertedMessage.id })}\n\n`)
                        }
                      } catch (dbError) {
                        console.error(`[${requestId}] Database error creating message:`, dbError)
                        safeEnqueue(`data: ${JSON.stringify({ error: 'Database error: ' + (dbError as Error).message })}\n\n`)
                        createdMessageIds.push('') // Push empty string to maintain index alignment
                      }
                      
                      // Process links - collect edge information
                      // Links are message IDs of existing user messages (panels) to connect to
                      if (panel.links && Array.isArray(panel.links) && sourcePanelMessageId) {
                        for (const targetPanelMessageId of panel.links) {
                          // Verify the target message ID exists and is a user message in this conversation
                          try {
                            const { data: targetMessage } = await supabase
                              .from('messages')
                              .select('id, role')
                              .eq('id', targetPanelMessageId)
                              .eq('conversation_id', conversationId)
                              .eq('role', 'user')
                              .single()
                            
                            if (targetMessage) {
                              // Valid link - add to edges array
                              edgesToCreate.push({
                                sourcePanelMessageId: sourcePanelMessageId,
                                targetPanelMessageId: targetPanelMessageId,
                              })
                              console.log(`[${requestId}] Edge to create: panel-${sourcePanelMessageId} -> panel-${targetPanelMessageId}`)
                            } else {
                              console.warn(`[${requestId}] Invalid link target message ID: ${targetPanelMessageId} (not found or not a user message)`)
                            }
                          } catch (linkError) {
                            console.error(`[${requestId}] Error validating link target:`, linkError)
                          }
                        }
                      }
                    } else {
                      // No content, push empty to maintain index alignment
                      createdMessageIds.push('')
                    }
                  }
                  
                  console.log(`[${requestId}] All ${createdMessageIds.filter(id => id).length} messages created, starting to stream content`)
                  
                  // Now stream content for all panels (messages are already in DB, so this is just for UX)
                  // Stream faster since messages are already saved
                  for (let i = 0; i < parsedData.panels.length; i++) {
                    const panel = parsedData.panels[i]
                    
                    if (panel.content && createdMessageIds[i]) {
                      const content = panel.content
                      const chunkSize = 200 // Larger chunks for faster streaming
                      for (let j = 0; j < content.length; j += chunkSize) {
                        const chunk = content.slice(j, j + chunkSize)
                        if (!safeEnqueue(`data: ${JSON.stringify({ content: chunk })}\n\n`)) {
                          // Stream closed, stop streaming
                          console.warn(`[${requestId}] Stream closed during streaming, stopping`)
                          break
                        }
                        // Very small delay for faster streaming
                        await new Promise(resolve => setTimeout(resolve, 2))
                      }
                    }
                  }
                  
                  // Save edges to database (lightweight - just message IDs)
                  if (edgesToCreate.length > 0 && sourcePanelMessageId) {
                    try {
                      // Get user_id from the conversation
                      const { data: conversationData } = await supabase
                        .from('conversations')
                        .select('user_id')
                        .eq('id', conversationId)
                        .single()
                      
                      if (conversationData?.user_id) {
                        // Insert edges in batch
                        const edgesToInsert = edgesToCreate.map(edge => ({
                          conversation_id: conversationId,
                          user_id: conversationData.user_id,
                          source_message_id: edge.sourcePanelMessageId,
                          target_message_id: edge.targetPanelMessageId,
                        }))
                        
                        const { error: edgesError } = await supabase
                          .from('panel_edges')
                          .insert(edgesToInsert)
                        
                        if (edgesError) {
                          console.error(`[${requestId}] Error saving edges to database:`, edgesError)
                          // Don't fail the request - edges will still be created in React Flow
                        } else {
                          console.log(`[${requestId}] ✅ Saved ${edgesToInsert.length} edges to database`)
                        }
                      }
                    } catch (edgesSaveError) {
                      console.error(`[${requestId}] Error saving edges:`, edgesSaveError)
                      // Don't fail the request - edges will still be created in React Flow
                    }
                  }
                  
                  // Send mapping data with edge information and close stream
                  console.log(`[${requestId}] Sending mapping data to client with ${edgesToCreate.length} edges`)
                  safeEnqueue(`data: ${JSON.stringify({ 
                    mapping: parsedData,
                    edges: edgesToCreate // Send edge data to client for React Flow edge creation
                  })}\n\n`)
                  safeEnqueue('data: [DONE]\n\n')
                  
                  // Small delay before closing to ensure all data is sent
                  await new Promise(resolve => setTimeout(resolve, 50))
                  
                  controller.close()
                  console.log(`[${requestId}] ✅ Deterministic mapping stream closed successfully`)
                } catch (panelError: any) {
                  console.error(`[${requestId}] Error processing panels:`, panelError)
                  console.error(`[${requestId}] Error stack:`, panelError?.stack)
                  safeEnqueue(`data: ${JSON.stringify({ error: 'Error processing panels: ' + (panelError?.message || 'Unknown error') })}\n\n`)
                  safeEnqueue('data: [DONE]\n\n')
                  try {
                    controller.close()
                  } catch (e) {
                    console.error(`[${requestId}] Error in final close attempt:`, e)
                  }
                }
              } else {
                // Fallback: if no parsed data or no panels, return error
                console.error(`[${requestId}] No panels in parsed data:`, parsedData)
                console.error(`[${requestId}] Parsed data type:`, typeof parsedData)
                console.error(`[${requestId}] Parsed data value:`, JSON.stringify(parsedData, null, 2))
                controller.enqueue(`data: ${JSON.stringify({ error: 'No panels generated from structured output', debug: { hasParsedData: !!parsedData, parsedDataType: typeof parsedData, parsedDataKeys: parsedData ? Object.keys(parsedData) : [] } })}\n\n`)
                controller.enqueue('data: [DONE]\n\n')
                controller.close()
              }
            } catch (parseError: any) {
              console.error(`[${requestId}] Error with structured output:`, parseError)
              console.error(`[${requestId}] Error stack:`, parseError?.stack)
              // Send error to client
              controller.enqueue(`data: ${JSON.stringify({ debug: 'Structured output error', error: String(parseError) })}\n\n`)
              
              // Fallback to regular streaming if structured output fails
              console.log(`[${requestId}] Falling back to regular streaming`)
              controller.enqueue(`data: ${JSON.stringify({ debug: 'Falling back to regular streaming' })}\n\n`)
              
              const fallbackCompletion = await openai.chat.completions.create({
                model: 'gpt-4o', // Use gpt-4o for more detailed responses
                messages: openaiMessages,
                stream: true,
                max_tokens: 4096, // Allow longer, more detailed responses
                temperature: 0.7, // Balanced creativity and coherence
              })

              for await (const chunk of fallbackCompletion) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (content) {
                  controller.enqueue(`data: ${JSON.stringify({ content })}\n\n`)
                }
              }
              
              // Create assistant message after streaming (for fallback)
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                // Note: We can't get the full content from streaming here easily
                // This is a limitation of the fallback - messages should be created client-side
                console.log(`[${requestId}] Fallback streaming complete - message should be created client-side`)
              }
            }
            
            // Always send [DONE] to close the stream
            controller.enqueue('data: [DONE]\n\n')
            controller.close()
          } else {
            // Regular streaming response
            console.log(`[${requestId}] Using regular streaming`)
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o', // Use gpt-4o for more detailed responses (instead of gpt-4o-mini)
              messages: openaiMessages,
              stream: true,
              max_tokens: 4096, // Allow longer, more detailed responses
              temperature: 0.7, // Balanced creativity and coherence
            })

            let chunkCount = 0
            let totalContentLength = 0
            for await (const chunk of completion) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (content) {
                chunkCount++
                totalContentLength += content.length
                controller.enqueue(`data: ${JSON.stringify({ content })}\n\n`)
              }
            }
            
            console.log(`[${requestId}] Streamed ${chunkCount} chunks, total length: ${totalContentLength} chars`)
            // Send [DONE] for regular streaming too
            controller.enqueue('data: [DONE]\n\n')
            controller.close()
            console.log(`[${requestId}] Stream closed successfully`)
          }
        } catch (error: any) {
          console.error(`[${requestId}] OpenAI API error:`, error)
          console.error(`[${requestId}] Error stack:`, error.stack)
          controller.enqueue(`data: ${JSON.stringify({ error: error.message })}\n\n`)
          controller.enqueue('data: [DONE]\n\n')
          controller.close()
        }
      },
    })
    
    console.log(`[${requestId}] Returning stream response`)

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    const requestId = Math.random().toString(36).substring(7)
    console.error(`[${requestId}] Chat API error (outer catch):`, error)
    console.error(`[${requestId}] Error stack:`, error.stack)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}



