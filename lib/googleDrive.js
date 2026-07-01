// lib/googleDrive.js
// Google Drive utility functions for server-side operations

import { google } from 'googleapis';
import { Readable } from 'stream';

/**
 * Initialize Google Drive client
 * @returns {Promise<Object>} Google Drive API client
 */
export async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a video file to Google Drive
 * @param {Buffer|string} fileData - File data as Buffer or base64 string
 * @param {Object} options - Upload options
 * @param {string} options.filename - Name of the file
 * @param {string} options.mimeType - MIME type of the file (default: video/mp4)
 * @param {string} options.folderId - Optional folder ID to upload to
 * @param {boolean} options.makePublic - Make file publicly accessible (default: true)
 * @returns {Promise<Object>} Uploaded file information
 */
export async function uploadVideo(fileData, options = {}) {
  const {
    filename = `video_${Date.now()}.mp4`,
    mimeType = 'video/mp4',
    folderId = null,
    makePublic = true,
  } = options;

  const drive = await getDriveClient();

  // Convert base64 to buffer if needed
  let fileBuffer;
  if (typeof fileData === 'string') {
    fileBuffer = Buffer.from(fileData, 'base64');
  } else if (fileData instanceof Buffer) {
    fileBuffer = fileData;
  } else {
    throw new Error('File data must be a Buffer or base64 string');
  }

  // Prepare file metadata
  const fileMetadata = {
    name: filename,
    parents: folderId ? [folderId] : undefined,
  };

  // Create a readable stream from the buffer
  const stream = Readable.from(fileBuffer);

  // Upload file to Google Drive
  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, name, webViewLink, webContentLink',
  });

  const fileId = response.data.id;

  // Make the file publicly accessible if requested
  if (makePublic) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
        fields: 'id',
      });
    } catch (permError) {
      console.log('Permission may already exist:', permError.message);
    }
  }

  // Get the updated file info
  const updatedFile = await drive.files.get({
    fileId,
    fields: 'id, name, webViewLink, webContentLink, thumbnailLink, mimeType',
  });

  // Generate different types of links
  const directLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const embedLink = `https://drive.google.com/file/d/${fileId}/preview`;
  const streamLink = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;

  return {
    id: fileId,
    name: updatedFile.data.name,
    mimeType: updatedFile.data.mimeType,
    webViewLink: updatedFile.data.webViewLink,
    webContentLink: updatedFile.data.webContentLink,
    directLink,
    embedLink,
    streamLink,
    thumbnailLink: updatedFile.data.thumbnailLink,
    // Video.js compatible source
    videoJsSource: {
      src: directLink,
      type: mimeType,
    },
  };
}

/**
 * Get shareable link for an existing Google Drive file
 * @param {string} fileId - Google Drive file ID
 * @param {boolean} makePublic - Make file publicly accessible (default: true)
 * @returns {Promise<Object>} File information with shareable links
 */
export async function getShareableLink(fileId, makePublic = true) {
  const drive = await getDriveClient();

  // Make the file publicly accessible if requested
  if (makePublic) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
        fields: 'id',
      });
    } catch (permError) {
      console.log('Permission may already exist:', permError.message);
    }
  }

  // Get the file info
  const file = await drive.files.get({
    fileId,
    fields: 'id, name, webViewLink, webContentLink, thumbnailLink, mimeType',
  });

  // Generate different types of links
  const directLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const embedLink = `https://drive.google.com/file/d/${fileId}/preview`;
  const streamLink = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;

  return {
    id: file.data.id,
    name: file.data.name,
    mimeType: file.data.mimeType,
    webViewLink: file.data.webViewLink,
    webContentLink: file.data.webContentLink,
    directLink,
    embedLink,
    streamLink,
    thumbnailLink: file.data.thumbnailLink,
    // Video.js compatible source
    videoJsSource: {
      src: directLink,
      type: file.data.mimeType || 'video/mp4',
    },
  };
}

/**
 * Delete a file from Google Drive
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFile(fileId) {
  const drive = await getDriveClient();

  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    console.error('Failed to delete file:', error);
    throw error;
  }
}

/**
 * List files in a folder
 * @param {string} folderId - Google Drive folder ID (optional, lists root if not provided)
 * @param {string} query - Additional query parameters
 * @returns {Promise<Array>} List of files
 */
export async function listFiles(folderId = null, query = '') {
  const drive = await getDriveClient();

  let q = "trashed = false";
  
  if (folderId) {
    q += ` and '${folderId}' in parents`;
  }
  
  if (query) {
    q += ` and ${query}`;
  }

  const response = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime)',
    orderBy: 'createdTime desc',
  });

  return response.data.files.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
    thumbnailLink: file.thumbnailLink,
    createdTime: file.createdTime,
    directLink: `https://drive.google.com/uc?export=download&id=${file.id}`,
  }));
}
