/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt
const SYSTEM_PROMPT =
	"You are Ryan's AI, a helpful, friendly assistant. Provide concise and accurate responses.";

// Limits so a single request can't send an enormous conversation
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	// Parse JSON request body
	let body: { messages?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "Body must be valid JSON" }, 400);
	}

	// Validate and clean the incoming messages
	const messages = sanitizeMessages(body.messages);
	if (!messages) {
		return jsonResponse({ error: "messages must be a non-empty array" }, 400);
	}

	try {
		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const inputs = {
			messages,
			max_tokens: 1024,
			stream: true,
		} satisfies AiTextGenerationInput & { stream: true };

		const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs, {
			// Uncomment to use AI Gateway
			// gateway: {
			//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
			//   skipCache: false,      // Set to true to bypass cache
			//   cacheTtl: 3600,        // Cache time-to-live in seconds
			// },
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return jsonResponse({ error: "Failed to process request" }, 500);
	}
}

/**
 * Keeps only well-formed messages and caps their size.
 * Returns null if nothing usable is left.
 */
function sanitizeMessages(input: unknown): ChatMessage[] | null {
	if (!Array.isArray(input) || input.length === 0) return null;

	const cleaned: ChatMessage[] = [];
	for (const m of input.slice(-MAX_MESSAGES)) {
		if (
			m &&
			(m.role === "system" || m.role === "user" || m.role === "assistant") &&
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

/**
 * Small helper for JSON responses
 */
function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}
