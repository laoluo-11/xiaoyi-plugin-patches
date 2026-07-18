"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseA2AMessage = parseA2AMessage;
exports.extractTextFromParts = extractTextFromParts;
exports.extractFileParts = extractFileParts;
exports.extractDataEvents = extractDataEvents;
exports.isClearContextMessage = isClearContextMessage;
exports.isTasksCancelMessage = isTasksCancelMessage;
exports.extractPushId = extractPushId;
exports.validateA2ARequest = validateA2ARequest;
const logger_js_1 = require("./xy-utils/logger.js");
/**
 * Parse an A2A JSON-RPC request into structured message data.
 */
function parseA2AMessage(request) {
    const { method, params, id } = request;
    if (!params) {
        throw new Error("A2A request missing params");
    }
    const { sessionId, message, id: paramsId } = params;
    if (!sessionId || !message) {
        throw new Error("A2A request params missing required fields");
    }
    return {
        sessionId,
        taskId: paramsId, // Task ID from params (对话唯一标识)
        messageId: id, // Global unique message sequence ID from top-level request
        parts: message.parts || [],
        deviceId: request.deviceId,        // Persistent device UUID (survives conversation restarts)
        deviceType: request.deviceType,    // e.g. "PAD"
        method,
    };
}
/**
 * Extract text content from message parts.
 */
function extractTextFromParts(parts) {
    const textParts = parts
        .filter((part) => part.kind === "text")
        .map((part) => part.text);
    return textParts.join("\n").trim();
}
/**
 * Extract file parts from message parts.
 */
function extractFileParts(parts) {
    return parts
        .filter((part) => part.kind === "file")
        .map((part) => part.file);
}
/**
 * Extract data events from message parts (for tool responses).
 */
function extractDataEvents(parts) {
    return parts
        .filter((part) => part.kind === "data")
        .map((part) => part.data.event)
        .filter((event) => event !== undefined);
}
/**
 * Check if message is a clearContext request.
 */
function isClearContextMessage(method) {
    return method === "clearContext" || method === "clear_context";
}
/**
 * Check if message is a tasks/cancel request.
 */
function isTasksCancelMessage(method) {
    return method === "tasks/cancel" || method === "tasks_cancel";
}
/**
 * Extract push_id from message parts.
 * Looks for push_id in data parts under variables.systemVariables.push_id
 */
function extractPushId(parts) {
    for (const part of parts) {
        if (part.kind === "data" && part.data) {
            const pushId = part.data.variables?.systemVariables?.push_id;
            if (pushId && typeof pushId === "string") {
                return pushId;
            }
        }
    }
    return null;
}
/**
 * Validate A2A request structure.
 */
function validateA2ARequest(request) {
    if (!request || typeof request !== "object") {
        return false;
    }
    if (request.jsonrpc !== "2.0") {
        logger_js_1.logger.warn("Invalid JSON-RPC version:", request.jsonrpc);
        return false;
    }
    if (!request.method || typeof request.method !== "string") {
        logger_js_1.logger.warn("Missing or invalid method");
        return false;
    }
    if (!request.id) {
        logger_js_1.logger.warn("Missing request id");
        return false;
    }
    if (!request.params || typeof request.params !== "object") {
        logger_js_1.logger.warn("Missing or invalid params");
        return false;
    }
    return true;
}
