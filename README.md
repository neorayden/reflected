# Reflected

A one-question psychological insight tool. You answer **Batman or Superman — and why?** and receive a reflective personality report based on what you project onto your choice.

- Single-page app, no login, no scoring
- Serious, reflective, non-diagnostic tone
- One free-text input, one submit, instant results

## Setup

1. Clone or download this repo.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and set your OpenAI API key:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `GROQ_API_KEY` and/or `HUGGINGFACE_API_KEY` (see `.env.example`).
4. Start the server:
   ```bash
   npm start
   ```
5. Open [http://localhost:3000](http://localhost:3000).

## Tech

- **Backend**: Node.js, Express, Groq API (primary) / Hugging Face (fallback)
- **Frontend**: Static HTML/CSS/JS, no framework
- **API**: `POST /api/insight` with body `{ "answer": "your text" }` returns `{ "report": "..." }`

## Constraints

The AI is instructed to avoid scores, type labels, diagnosis, and moral judgment; to be precise and humble; and to produce a report that feels personally accurate and thought-provoking.
