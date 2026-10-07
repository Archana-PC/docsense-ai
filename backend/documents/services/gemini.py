"""
Google Gemini AI service for embeddings, contextual query reformulation,
and multi-turn RAG question-answering with memory.
"""
import logging
from typing import List, Dict, Any, Optional
from django.conf import settings
import google.generativeai as genai

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "models/text-embedding-004"
CHAT_MODEL = "gemini-1.5-flash"
EMBEDDING_DIMENSIONS = 768


def get_api_key(provided_key: Optional[str] = None) -> str:
    """Returns the API key from argument or Django settings."""
    return provided_key or getattr(settings, 'GEMINI_API_KEY', '') or ''


def is_gemini_configured(provided_key: Optional[str] = None) -> bool:
    """Check if a Gemini API key is configured."""
    key = get_api_key(provided_key)
    return bool(key and key.strip())


def generate_embedding(text: str, api_key: Optional[str] = None, is_query: bool = False) -> List[float]:
    """
    Generate a 768-dimensional vector embedding for a single text chunk or query.
    """
    key = get_api_key(api_key)
    if not key:
        raise ValueError(
            "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file."
        )

    genai.configure(api_key=key)
    task_type = "retrieval_query" if is_query else "retrieval_document"

    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=text,
        task_type=task_type,
    )
    return result['embedding']


def generate_embeddings_batch(texts: List[str], api_key: Optional[str] = None) -> List[List[float]]:
    """
    Generate embeddings in batch for multiple text chunks.
    """
    key = get_api_key(api_key)
    if not key:
        raise ValueError(
            "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file."
        )

    genai.configure(api_key=key)
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=texts,
        task_type="retrieval_document",
    )
    return result['embedding']


def contextualize_query(
    question: str, 
    chat_history: List[Dict[str, str]], 
    api_key: Optional[str] = None
) -> str:
    """
    Given chat history and a follow-up question, rewrite the question to be a standalone
    query suitable for vector search.
    Example:
    History: [User: "Who is the candidate?", AI: "The candidate is Archana."]
    Question: "What is her experience?" -> "What is Archana's experience?"
    """
    if not chat_history:
        return question

    key = get_api_key(api_key)
    if not key:
        return question

    try:
        genai.configure(api_key=key)
        model = genai.GenerativeModel(CHAT_MODEL)

        history_str = ""
        for msg in chat_history[-6:]:  # last 3 turns
            role_label = "User" if msg.get('role') == 'user' else "Assistant"
            history_str += f"{role_label}: {msg.get('content', '')}\n"

        prompt = f"""Given the following conversation history and a follow-up user question, rephrase the question to be a standalone query that can be understood without the conversation history.
Do NOT answer the question. Only output the reformulated question. If the question is already standalone, return it unchanged.

Conversation History:
{history_str}

Follow-up Question: {question}

Standalone Question:"""

        response = model.generate_content(prompt)
        reformulated = response.text.strip()
        logger.info(f"Contextualized query '{question}' -> '{reformulated}'")
        return reformulated or question
    except Exception as e:
        logger.warning(f"Query contextualization failed: {e}. Using original question.")
        return question


def answer_question_with_context(
    question: str, 
    context_chunks: List[Dict[str, Any]], 
    chat_history: Optional[List[Dict[str, str]]] = None,
    api_key: Optional[str] = None
) -> str:
    """
    Pass retrieved document context, conversation history, and user question to Gemini to generate an answer.
    """
    key = get_api_key(api_key)
    if not key:
        raise ValueError(
            "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file."
        )

    genai.configure(api_key=key)
    model = genai.GenerativeModel(CHAT_MODEL)

    # Format context with page markers
    formatted_context = ""
    for idx, chunk in enumerate(context_chunks, 1):
        page_info = f" (Page {chunk.get('page_number')})" if chunk.get('page_number') else ""
        formatted_context += f"--- Source Snippet {idx}{page_info} ---\n{chunk['content']}\n\n"

    # Format chat history
    formatted_history = ""
    if chat_history:
        formatted_history = "PREVIOUS CONVERSATION TURNS:\n"
        for msg in chat_history[-6:]:
            role_label = "User" if msg.get('role') == 'user' else "Assistant"
            formatted_history += f"{role_label}: {msg.get('content', '')}\n"
        formatted_history += "\n"

    prompt = f"""You are DocSense AI, an expert document intelligence assistant.
Your task is to accurately answer the user's question using the provided document context below, while maintaining conversational continuity with previous turns.

Instructions:
1. Ground your answer strictly in the provided document context sources.
2. If the user asks a follow-up question, use the previous conversation history to understand pronouns and context.
3. If the answer cannot be found in the document context, state: "I cannot find the answer to this question in the uploaded document."
4. Reference specific pages whenever available (e.g. "[Page 2]").
5. Format your answer with clear markdown (bullet points, bold text).

{formatted_history}DOCUMENT CONTEXT SOURCES:
{formatted_context}

CURRENT QUESTION:
{question}

ANSWER:"""

    response = model.generate_content(prompt)
    return response.text


def stream_answer_with_context(
    question: str, 
    context_chunks: List[Dict[str, Any]], 
    chat_history: Optional[List[Dict[str, str]]] = None,
    api_key: Optional[str] = None
):
    """
    Stream token chunks in real time as Gemini generates the response.
    Yields string text chunks.
    """
    key = get_api_key(api_key)
    if not key:
        raise ValueError(
            "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file."
        )

    genai.configure(api_key=key)
    model = genai.GenerativeModel(CHAT_MODEL)

    formatted_context = ""
    for idx, chunk in enumerate(context_chunks, 1):
        page_info = f" (Page {chunk.get('page_number')})" if chunk.get('page_number') else ""
        formatted_context += f"--- Source Snippet {idx}{page_info} ---\n{chunk['content']}\n\n"

    formatted_history = ""
    if chat_history:
        formatted_history = "PREVIOUS CONVERSATION TURNS:\n"
        for msg in chat_history[-6:]:
            role_label = "User" if msg.get('role') == 'user' else "Assistant"
            formatted_history += f"{role_label}: {msg.get('content', '')}\n"
        formatted_history += "\n"

    prompt = f"""You are DocSense AI, an expert document intelligence assistant.
Your task is to accurately answer the user's question using the provided document context below, while maintaining conversational continuity with previous turns.

Instructions:
1. Ground your answer strictly in the provided document context sources.
2. If the user asks a follow-up question, use the previous conversation history to understand pronouns and context.
3. If the answer cannot be found in the document context, state: "I cannot find the answer to this question in the uploaded document."
4. Reference specific pages whenever available (e.g. "[Page 2]").
5. Format your answer with clear markdown (bullet points, bold text).

{formatted_history}DOCUMENT CONTEXT SOURCES:
{formatted_context}

CURRENT QUESTION:
{question}

ANSWER:"""

    response = model.generate_content(prompt, stream=True)
    for chunk in response:
        if chunk.text:
            yield chunk.text
