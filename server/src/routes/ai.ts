import { Router } from 'express'
import { z } from 'zod'
import Groq from 'groq-sdk'

export const AIRouter = Router()

const requestSchema = z.object({
  prompt: z.string().min(1),
  fullText: z.string(),
  selectionStart: z.number().int().min(0),
  selectionEnd: z.number().int().min(0),
})

const editArgsSchema = z.object({
  explanation: z.string(),
  suggestedText: z.string(),
})

const textArgsSchema = z.object({
  text: z.string(),
})

const groq = new Groq()

const SYSTEM_PROMPT = `You are a pair-programming assistant embedded in a code editor.

You will be given, in the user message: an instruction describing what the user wants, the code immediately before their cursor or selection, the selected text itself (empty if they only had a cursor, not a selection), and the code immediately after.

Always respond by calling exactly one tool — never respond with plain text directly.
- If the user is asking you to change the code (write, fix, refactor, etc.), call "propose_edit":
  - "explanation": a short, plain-language description of what the edit does and why, written for an engineer reviewing your suggestion before deciding whether to accept it.
  - "suggestedText": the exact text that should replace the selection (or be inserted at the cursor, if there was no selection). This is inserted literally with no reformatting, so it must already match the surrounding code's indentation, and must start with a newline if it should begin on its own line rather than continuing the current line of code.
- If the user is asking you to explain code, or asking a question that doesn't require editing the code, call "respond_text":
  - "text": a plain-language explanation or answer, written for the engineer who asked.`

AIRouter.post('/ai', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }

  const { prompt, fullText, selectionStart, selectionEnd } = parsed.data
  const prefix = fullText.slice(0, selectionStart)
  const selected = fullText.slice(selectionStart, selectionEnd)
  const suffix = fullText.slice(selectionEnd)

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Instruction: ${prompt}

Code before cursor:
${prefix}

Selected code (to replace; empty if this was just a cursor, not a selection):
${selected}

Code after cursor:
${suffix}`,
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'propose_edit',
            description: 'Propose a code edit for the user to review and accept or reject.',
            parameters: {
              type: 'object',
              properties: {
                explanation: {
                  type: 'string',
                  description: 'A short, plain-language explanation of what this edit does and why.',
                },
                suggestedText: {
                  type: 'string',
                  description:
                    'The exact text to insert in place of the selection (or at the cursor). Must match surrounding indentation, and include a leading newline if it should start on its own line.',
                },
              },
              required: ['explanation', 'suggestedText'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'respond_text',
            description: 'Explain code, or answer a question, with no code edit attached.',
            parameters: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: 'The plain-language explanation or answer.',
                },
              },
              required: ['text'],
            },
          },
        },
      ],
      tool_choice: 'required',
    })

    const toolCall = completion.choices[0]?.message.tool_calls?.[0]
    if (!toolCall) {
      return res.status(502).json({ error: 'model did not return a response' })
    }

    let parsedArgs: unknown
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments)
    } catch {
      return res.status(502).json({ error: 'model returned malformed JSON' })
    }

    if (toolCall.function.name === 'propose_edit') {
      const edit = editArgsSchema.safeParse(parsedArgs)
      if (!edit.success) {
        return res.status(502).json({ error: 'model returned a malformed edit' })
      }
      return res.json({ type: 'edit', ...edit.data })
    }

    if (toolCall.function.name === 'respond_text') {
      const text = textArgsSchema.safeParse(parsedArgs)
      if (!text.success) {
        return res.status(502).json({ error: 'model returned a malformed response' })
      }
      return res.json({ type: 'text', ...text.data })
    }

    return res.status(502).json({ error: 'model called an unknown tool' })
  } catch (err) {
    console.error('[ai] generation failed:', err)
    res.status(500).json({ error: 'AI generation failed' })
  }
})
