import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// Multer for audio uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage() });

// API clients (defer errors to actual API call time, not startup)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing' });

// Route Claude calls through Portkey gateway
const PORTKEY_API_KEY = process.env.PORTKEY_API_KEY;
const PORTKEY_PROVIDER = process.env.PORTKEY_PROVIDER || '@azure-anthropic-east-us2';
const anthropic = new Anthropic({
  baseURL: PORTKEY_API_KEY ? 'https://api.portkey.ai' : undefined,
  apiKey: PORTKEY_API_KEY || process.env.ANTHROPIC_API_KEY || 'missing',
  defaultHeaders: PORTKEY_API_KEY
    ? {
        'x-portkey-api-key': PORTKEY_API_KEY,
        'x-portkey-provider': PORTKEY_PROVIDER,
      }
    : {},
});

// ─── Route 1: Transcribe audio via Whisper ───────────────────────────────────

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Write buffer to a temp file (Whisper API needs a file-like object)
    const tempPath = join(__dirname, `temp_${Date.now()}.webm`);
    fs.writeFileSync(tempPath, req.file.buffer);

    try {
      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: fs.createReadStream(tempPath),
        response_format: 'text',
      });

      res.json({ text: transcription });
    } finally {
      // Clean up temp file
      fs.unlinkSync(tempPath);
    }
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: 'Transcription failed', details: err.message });
  }
});

// ─── Route 2: Generate quiz via Claude ───────────────────────────────────────

app.post('/api/generate-quiz', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'No transcript provided' });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are a quiz generator for a live educational presentation. Based on the transcript below, generate a quiz that tests the audience's understanding of what was just presented.

Rules:
- Generate 5-8 multiple choice questions
- Each question should have exactly 4 options
- Questions should cover the key concepts mentioned in the talk
- Make questions engaging and clear — this is for a live audience
- Include a brief explanation for each correct answer
- The quiz title should reflect the topic of the talk

Return ONLY valid JSON in this exact format, no markdown, no code fences:
{
  "title": "Quiz title here",
  "questions": [
    {
      "question": "Question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Brief explanation of why this is correct"
    }
  ]
}

TRANSCRIPT:
${transcript}`,
        },
      ],
    });

    const content = message.content[0].text;
    const quiz = JSON.parse(content);
    res.json(quiz);
  } catch (err) {
    console.error('Quiz generation error:', err);
    res.status(500).json({ error: 'Quiz generation failed', details: err.message });
  }
});

// ─── Route 3: Check which topics are covered ────────────────────────────────

app.post('/api/check-topics', async (req, res) => {
  try {
    const { transcript, topics = [], standards = [] } = req.body;
    if (!transcript || (topics.length === 0 && standards.length === 0)) {
      return res.json({ coveredTopics: [], coveredStandards: [] });
    }

    const topicList = topics.map((t, i) => `${i}: ${t}`).join('\n');
    const standardList = standards.map((s, i) => `${i}: ${s}`).join('\n');

    const hasUncovered = topics.some((t, i) => true) || standards.some((s, i) => true);

    let prompt = `You are a teaching copilot analyzing a live presentation. Given the transcript, determine which topics and learning objectives have been meaningfully covered (explained or discussed, not just briefly mentioned).

TRANSCRIPT:
${transcript}

`;
    if (topics.length > 0) {
      prompt += `TOPICS:\n${topicList}\n\n`;
    }
    if (standards.length > 0) {
      prompt += `LEARNING OBJECTIVES:\n${standardList}\n\n`;
    }
    prompt += `Return ONLY valid JSON in this exact format, no markdown:
{
  "coveredTopics": [0, 2],
  "coveredStandards": [1],
  "suggestion": "A brief, actionable suggestion for the presenter about what to cover next or how to address an uncovered topic/learning objective. Keep it to 1-2 sentences. If everything is covered, say so."
}
Use empty arrays if none are covered.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0].text.trim();
    const result = JSON.parse(content);
    res.json({
      coveredTopics: result.coveredTopics || [],
      coveredStandards: result.coveredStandards || [],
      suggestion: result.suggestion || null,
    });
  } catch (err) {
    console.error('Check topics error:', err);
    res.json({ coveredTopics: [], coveredStandards: [], suggestion: null });
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  WayAround running at http://localhost:${PORT}\n`);
});
