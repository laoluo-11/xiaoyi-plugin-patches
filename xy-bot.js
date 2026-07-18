"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleXYMessage = handleXYMessage;
const runtime_js_1 = require("./runtime.js");
const xy_reply_dispatcher_js_1 = require("./xy-reply-dispatcher.js");
const xy_parser_js_1 = require("./xy-parser.js");
const file_download_js_1 = require("./file-download.js");
const xy_config_js_1 = require("./xy-config.js");
const xy_formatter_js_1 = require("./xy-formatter.js");
const session_manager_js_1 = require("./xy-tools/session-manager.js");
const config_manager_js_1 = require("./xy-utils/config-manager.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
/**
 * Handle an incoming A2A message.
 * This is the main entry point for message processing.
 * Runtime is expected to be validated before calling this function.
 */
async function handleXYMessage(params) {
    const { cfg, runtime, message, accountId } = params;
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Get OpenClaw PluginRuntime (not XiaoYiRuntime)
    const xiaoYiRuntime = (0, runtime_js_1.getXiaoYiRuntime)();
    const core = xiaoYiRuntime.getPluginRuntime();
    try {
        // Check for special messages BEFORE parsing (these have different param structures)
        const messageMethod = message.method;
        log(`[BOT-ENTRY] <<<<<<< Received message with method: ${messageMethod}, id: ${message.id} >>>>>>>`);
        log(`[BOT-ENTRY] Stack trace for debugging:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
        // Handle clearContext messages (params only has sessionId)
        if (messageMethod === "clearContext" || messageMethod === "clear_context") {
            const sessionId = message.params?.sessionId;
            if (!sessionId) {
                throw new Error("clearContext request missing sessionId in params");
            }
            log(`Clear context request for session ${sessionId}`);
            const config = (0, xy_config_js_1.resolveXYConfig)(cfg);
            await (0, xy_formatter_js_1.sendClearContextResponse)({
                config,
                sessionId,
                messageId: message.id,
            });
            return;
        }
        // Handle tasks/cancel messages
        if (messageMethod === "tasks/cancel" || messageMethod === "tasks_cancel") {
            const sessionId = message.params?.sessionId;
            const taskId = message.params?.id || message.id;
            if (!sessionId) {
                throw new Error("tasks/cancel request missing sessionId in params");
            }
            log(`Tasks cancel request for session ${sessionId}, task ${taskId}`);
            const config = (0, xy_config_js_1.resolveXYConfig)(cfg);
            await (0, xy_formatter_js_1.sendTasksCancelResponse)({
                config,
                sessionId,
                taskId,
                messageId: message.id,
            });
            return;
        }
        // Parse the A2A message (for regular messages)
        const parsed = (0, xy_parser_js_1.parseA2AMessage)(message);
        // Extract and update push_id if present
        const pushId = (0, xy_parser_js_1.extractPushId)(parsed.parts);
        if (pushId) {
            log(`[BOT] 📌 Extracted push_id from user message`);
            log(`[BOT]   - Session ID: ${parsed.sessionId}`);
            log(`[BOT]   - Push ID preview: ${pushId.substring(0, 20)}...`);
            log(`[BOT]   - Full push_id: ${pushId}`);
            config_manager_js_1.configManager.updatePushId(parsed.sessionId, pushId);
        }
        else {
            log(`[BOT] ℹ️  No push_id found in message, will use config default`);
        }
        // Resolve configuration (needed for status updates)
        const config = (0, xy_config_js_1.resolveXYConfig)(cfg);
        // ✅ Resolve agent route (following feishu pattern)
        // accountId is "default" for XY (single account mode)
        // Use sessionId as peer.id to ensure all messages in the same session share context
        let route = core.channel.routing.resolveAgentRoute({
            cfg,
            channel: "xiaoyi-channel",
            accountId, // "default"
            peer: {
                kind: "direct",
                id: parsed.deviceId || parsed.sessionId, // ✅ Use deviceId for per-device session isolation (fallback to sessionId)
            },
        });
        log(`xy: resolved route accountId=${route.accountId}, sessionKey=${route.sessionKey}`);
        // Register session context for tools
        log(`[BOT] 📝 About to register session for tools...`);
        log(`[BOT]   - sessionKey: ${route.sessionKey}`);
        log(`[BOT]   - sessionId: ${parsed.sessionId}`);
        log(`[BOT]   - taskId: ${parsed.taskId}`);
        (0, session_manager_js_1.registerSession)(route.sessionKey, {
            config,
            sessionId: parsed.sessionId,
            taskId: parsed.taskId,
            messageId: parsed.messageId,
            agentId: route.accountId,
        });
        log(`[BOT] ✅ Session registered for tools`);
        // Send initial status update immediately after parsing message
        log(`[STATUS] Sending initial status update for session ${parsed.sessionId}`);
        void (0, xy_formatter_js_1.sendStatusUpdate)({
            config,
            sessionId: parsed.sessionId,
            taskId: parsed.taskId,
            messageId: parsed.messageId,
            text: "任务正在处理中，请稍后~",
            state: "working",
        }).catch((err) => {
            error(`Failed to send initial status update:`, err);
        });
        // Extract text and files from parts
        const text = (0, xy_parser_js_1.extractTextFromParts)(parsed.parts);
        const fileParts = (0, xy_parser_js_1.extractFileParts)(parsed.parts);
        // Download files if present (using core's media download)
        const mediaList = await (0, file_download_js_1.downloadFilesFromParts)(fileParts, undefined, parsed.deviceId || parsed.sessionId);
        // Build media payload for inbound context (following feishu pattern)
        const mediaPayload = buildXYMediaPayload(mediaList);
        // Resolve envelope format options (following feishu pattern)
        const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
        // Device-scoped memory context
        const deviceId = parsed.deviceId || parsed.sessionId;
        const workspaceRoot = (cfg && cfg.agents && cfg.agents.defaults && cfg.agents.defaults.workspace) 
            || path.join(os.homedir(), '.openclaw', 'workspace');
        const deviceDir = path.join(workspaceRoot, 'devices', deviceId);
        const deviceUserPath = path.join(deviceDir, 'USER.md');
        const deviceMemoryPath = path.join(deviceDir, 'MEMORY.md');
        if (!fs.existsSync(deviceDir)) {
            fs.mkdirSync(deviceDir, { recursive: true });
            const userTemplate = '# USER.md - 本设备专属用户档案\n\n> 此文件仅供当前设备（' + deviceId + '）使用，与其他设备完全隔离。\n\n- **Name:** （待了解）\n- **What to call them:** （待了解）\n- **Notes:** \n';
            const memoryTemplate = '# MEMORY.md - 本设备专属任务记录\n\n> 此文件仅供当前设备使用，与其他设备完全隔离。\n\n## 任务列表\n\n（暂无）\n';
            fs.writeFileSync(deviceUserPath, userTemplate);
            fs.writeFileSync(deviceMemoryPath, memoryTemplate);
        }
        let deviceUserMd = '';
        let deviceMemoryMd = '';
        try { deviceUserMd = fs.readFileSync(deviceUserPath, 'utf-8'); } catch(e) {}
        try { deviceMemoryMd = fs.readFileSync(deviceMemoryPath, 'utf-8'); } catch(e) {}
        const devicePrefix = '[系统] 当前设备ID: ' + deviceId + '\n'
            + '本设备专属目录（绝对路径）: ' + deviceDir + '\n'
            + '用户档案: ' + deviceUserPath + '\n'
            + '任务记录: ' + deviceMemoryPath + '\n'
            + '安全规则: 只读写上述绝对路径下的文件。严禁访问工作空间根目录的 USER.md/MEMORY.md（已设只读保护）。严禁访问其他设备目录。\n\n'
            + '## 本设备用户档案\n' + deviceUserMd + '\n'
            + '## 本设备任务记录\n' + deviceMemoryMd + '\n'
            + '---以下是用户消息---\n';
        // Build message body with speaker prefix (following feishu pattern)
        let messageBody = devicePrefix + (text || "");
        // Add speaker prefix for clarity
        const speaker = parsed.sessionId;
        messageBody = `${speaker}: ${messageBody}`;
        // Format agent envelope (following feishu pattern)
        const body = core.channel.reply.formatAgentEnvelope({
            channel: "xiaoyi-channel",
            from: speaker,
            timestamp: new Date(),
            envelope: envelopeOptions,
            body: messageBody,
        });
        // ✅ Finalize inbound context (following feishu pattern)
        // Use route.accountId and route.sessionKey instead of parsed fields
        const ctxPayload = core.channel.reply.finalizeInboundContext({
            Body: body,
            RawBody: text || "",
            CommandBody: text || "",
            From: parsed.sessionId,
            To: parsed.sessionId, // ✅ Simplified: use sessionId as target (context is managed by SessionKey)
            SessionKey: route.sessionKey, // ✅ Use route.sessionKey
            AccountId: route.accountId, // ✅ Use route.accountId ("default")
            ChatType: "direct",
            GroupSubject: undefined,
            SenderName: parsed.sessionId,
            SenderId: parsed.sessionId,
            Provider: "xiaoyi-channel",
            Surface: "xiaoyi-channel",
            MessageSid: parsed.messageId,
            Timestamp: Date.now(),
            WasMentioned: false,
            CommandAuthorized: true,
            OriginatingChannel: "xiaoyi-channel",
            OriginatingTo: parsed.sessionId, // Original message target
            ReplyToBody: undefined, // A2A protocol doesn't support reply/quote
            ...mediaPayload,
        });
        // Send initial status update immediately after parsing message
        log(`[STATUS] Sending initial status update for session ${parsed.sessionId}`);
        void (0, xy_formatter_js_1.sendStatusUpdate)({
            config,
            sessionId: parsed.sessionId,
            taskId: parsed.taskId,
            messageId: parsed.messageId,
            text: "任务正在处理中，请稍后~",
            state: "working",
        }).catch((err) => {
            error(`Failed to send initial status update:`, err);
        });
        // Create reply dispatcher (following feishu pattern)
        log(`[BOT-DISPATCHER] 🎯 Creating reply dispatcher for session=${parsed.sessionId}, taskId=${parsed.taskId}, messageId=${parsed.messageId}`);
        const { dispatcher, replyOptions, markDispatchIdle, startStatusInterval } = (0, xy_reply_dispatcher_js_1.createXYReplyDispatcher)({
            cfg,
            runtime,
            sessionId: parsed.sessionId,
            taskId: parsed.taskId,
            messageId: parsed.messageId,
            accountId: route.accountId, // ✅ Use route.accountId
        });
        log(`[BOT-DISPATCHER] ✅ Reply dispatcher created successfully`);
        // Start status update interval (will send updates every 60 seconds)
        // Interval will be automatically stopped when onIdle/onCleanup is triggered
        startStatusInterval();
        log(`xy: dispatching to agent (session=${parsed.sessionId})`);
        // Dispatch to OpenClaw core using correct API (following feishu pattern)
        log(`[BOT] 🚀 Starting dispatcher with session: ${route.sessionKey}`);
        await core.channel.reply.withReplyDispatcher({
            dispatcher,
            onSettled: () => {
                log(`[BOT] 🏁 onSettled called for session: ${route.sessionKey}`);
                log(`[BOT]   - About to unregister session...`);
                markDispatchIdle();
                // Unregister session context when done
                (0, session_manager_js_1.unregisterSession)(route.sessionKey);
                log(`[BOT] ✅ Session unregistered in onSettled`);
            },
            run: () => core.channel.reply.dispatchReplyFromConfig({
                ctx: ctxPayload,
                cfg,
                dispatcher,
                replyOptions,
            }),
        });
        log(`[BOT] ✅ Dispatcher completed for session: ${parsed.sessionId}`);
        log(`xy: dispatch complete (session=${parsed.sessionId})`);
    }
    catch (err) {
        // ✅ Only log error, don't re-throw to prevent gateway restart
        error("Failed to handle XY message:", err);
        runtime.error?.(`xy: Failed to handle message: ${String(err)}`);
        log(`[BOT] ❌ Error occurred, attempting cleanup...`);
        // Try to unregister session on error (if route was established)
        try {
            const xiaoYiRuntime = (0, runtime_js_1.getXiaoYiRuntime)();
            const core = xiaoYiRuntime.getPluginRuntime();
            const params = message.params;
            const sessionId = params?.sessionId;
            if (sessionId) {
                log(`[BOT] 🧹 Cleaning up session after error: ${sessionId}`);
                const route = core.channel.routing.resolveAgentRoute({
                    cfg,
                    channel: "xiaoyi-channel",
                    accountId,
                    peer: {
                        kind: "direct",
                        id: sessionId, // ✅ Use sessionId for cleanup consistency
                    },
                });
                log(`[BOT]   - Unregistering session: ${route.sessionKey}`);
                (0, session_manager_js_1.unregisterSession)(route.sessionKey);
                log(`[BOT] ✅ Session unregistered after error`);
            }
        }
        catch (cleanupErr) {
            log(`[BOT] ⚠️  Cleanup failed:`, cleanupErr);
            // Ignore cleanup errors
        }
        // ❌ Don't re-throw: message processing error should not affect gateway stability
    }
}
/**
 * Build media payload for inbound context.
 * Following feishu pattern: buildFeishuMediaPayload().
 */
function buildXYMediaPayload(mediaList) {
    const first = mediaList[0];
    const mediaPaths = mediaList.map((media) => media.path);
    const mediaTypes = mediaList.map((media) => media.mimeType).filter(Boolean);
    return {
        MediaPath: first?.path,
        MediaType: first?.mimeType,
        MediaUrl: first?.path,
        MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
        MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
        MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
    };
}
/**
 * Infer OpenClaw media type from file type string.
 */
function inferMediaType(fileType) {
    const lower = fileType.toLowerCase();
    if (lower.includes("image") || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(lower)) {
        return "image";
    }
    if (lower.includes("video") || /\.(mp4|avi|mov|mkv|webm)$/i.test(lower)) {
        return "video";
    }
    if (lower.includes("audio") || /\.(mp3|wav|ogg|m4a)$/i.test(lower)) {
        return "audio";
    }
    return "file";
}
