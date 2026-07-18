"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFile = downloadFile;
exports.downloadFilesFromParts = downloadFilesFromParts;
// File download utilities
const node_fetch_1 = __importDefault(require("node-fetch"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const logger_js_1 = require("./xy-utils/logger.js");
/**
 * Download a file from URL to local path.
 */
async function downloadFile(url, destPath) {
    logger_js_1.logger.debug(`Downloading file from ${url} to ${destPath}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout
    try {
        const response = await (0, node_fetch_1.default)(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await promises_1.default.writeFile(destPath, buffer);
        logger_js_1.logger.debug(`File downloaded successfully: ${destPath}`);
    }
    catch (error) {
        if (error.name === 'AbortError') {
            logger_js_1.logger.error(`Download timeout (30s) for ${url}`);
            throw new Error(`Download timeout after 30 seconds`);
        }
        logger_js_1.logger.error(`Failed to download file from ${url}:`, error);
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Download files from A2A file parts.
 * Returns array of local file paths.
 */
async function downloadFilesFromParts(fileParts, tempDir = "/home/dfzz/.openclaw/workspace/media/xy_channel", deviceId = "default") {
    // Append device ID for per-device isolation
    tempDir = path_1.default.join(tempDir, deviceId);
    // Create temp directory if it doesn't exist
    await promises_1.default.mkdir(tempDir, { recursive: true });
    const downloadedFiles = [];
    for (const filePart of fileParts) {
        const { name, mimeType, uri } = filePart;
        // Generate safe file name
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const destPath = path_1.default.join(tempDir, `${Date.now()}_${safeName}`);
        try {
            await downloadFile(uri, destPath);
            downloadedFiles.push({
                path: destPath,
                name,
                mimeType,
            });
        }
        catch (error) {
            logger_js_1.logger.error(`Failed to download file ${name}:`, error);
            // Continue with other files
        }
    }
    return downloadedFiles;
}
