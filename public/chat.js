/**
 * Backend for Ryan's AI.
 *
 * POST /api/chat  { messages: [{ role, content }, ...] }
 *   -> streams Server-Sent Events (SSE) from Workers AI, in the format
 *      chat.js already parses: data: {"response":"..."} ... data: [DONE]
 *
 * Everything else is served from the static assets folder (index.html, chat.js).
 */

export interface Env {
	AI: Ai;
	ASSETS: Fetcher;
}

type ChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SYSTEM_PROMPT =
	"You are Ryan's AI, a helpful and friendly assistant. Give concise, accurate answers.";

const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/chat") {
			if (request.method !== "POST") {
				return json({ error: "Method not allowed" }, 405);
			}
			return handleChat(request, env);
		}

		// Serve index.html, chat.js, etc.
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

async function handleChat(request: Request, env: Env): Promise<Response> {
	let body: { messages?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: "Body must be valid JSON" }, 400);
	}

	const messages = sanitizeMessages(body.messages);
	if (!messages) {
		return json({ error: "messages must be a non-empty array" }, 400);
	}

	// Always lead with our system prompt (ignore any client-supplied one)
	const fullMessages: ChatMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		...messages,
	];

	try {
		const stream = await env.AI.run(MODEL, {
			messages: fullMessages,
			max_tokens: 1024,
			stream: true,
		});

		return new Response(stream as ReadableStream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (err) {
		console.error("Workers AI error:", err);
		return json({ error: "Failed to get a response from the model" }, 500);
	}
}

/** Keep only well-formed user/assistant messages and cap their size. */
function sanitizeMessages(input: unknown): ChatMessage[] | null {
	if (!Array.isArray(input) || input.length === 0) return null;

	const cleaned: ChatMessage[] = [];
	for (const m of input.slice(-MAX_MESSAGES)) {
		if (
			m &&
			(m.role === "user" || m.role === "assistant") &&
			typeof m.content === "string" &&
			m.content.trim() !== ""
		) {
			cleaned.push({
				role: m.role,
				content: m.content.slice(0, MAX_CONTENT_LENGTH),
			});
		}
	}
	return cleaned.length > 0 ? cleaned : null;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}
