// pages/api/drive/upload.js
// Public endpoint for uploading videos to Google Drive
// Anyone can use this endpoint with proper authentication

import { google } from 'googleapis';
import { Readable } from 'stream';

// Disable body parsing limit for large file uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Adjust based on your needs
    },
  },
};

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { file, filename, folderId } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'File data is required' });
    }

    // Initialize Google Drive client using service account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Prepare file metadata
    const fileMetadata = {
      name: filename || `video_${Date.now()}.mp4`,
      parents: folderId ? [folderId] : undefined,
    };

    // Convert base64 file to buffer
    const fileBuffer = Buffer.from(file, 'base64');

    // Create a readable stream from the buffer
    const stream = Readable.from(fileBuffer);

    // Upload file to Google Drive
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: 'video/mp4',
        body: stream,
      },
      fields: 'id, name, webViewLink, webContentLink',
    });

    const fileId = response.data.id;

    // Make the file publicly accessible (anyone with link can view)
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
      fields: 'id',
    });

    // Get the updated file info with the shareable link
    const updatedFile = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, webViewLink, webContentLink, thumbnailLink',
    });

    // Convert webContentLink to a direct download/streaming link
    // Google Drive webContentLink is already a direct link, but we need to ensure it's usable for video streaming
    const directLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const embedLink = `https://drive.google.com/file/d/${fileId}/preview`;

    res.status(200).json({
      success: true,
      data: {
        id: fileId,
        name: updatedFile.data.name,
        webViewLink: updatedFile.data.webViewLink,
        webContentLink: updatedFile.data.webContentLink,
        directLink: directLink,
        embedLink: embedLink,
        thumbnailLink: updatedFile.data.thumbnailLink,
      },
    });
  } catch (error) {
    console.error('Google Drive upload error:', error);
    
    if (error.message.includes('credential')) {
      return res.status(500).json({ 
        error: 'Google Drive authentication failed. Please check your credentials.',
        details: error.message 
      });
    }

    res.status(500).json({ 
      error: 'Failed to upload file to Google Drive',
      details: error.message 
    });
  }
}
