// pages/api/drive/share.js
// Public endpoint for getting shareable links from Google Drive
// Anyone can use this endpoint to make files public and get streaming links

import { google } from 'googleapis';

export default async function handler(req, res) {
  // Allow GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileId } = req.query;
    const { fileId: fileIdFromBody } = req.body;
    
    const targetFileId = fileId || fileIdFromBody;

    if (!targetFileId) {
      return res.status(400).json({ error: 'File ID is required' });
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

    // Make the file publicly accessible (anyone with link can view)
    try {
      await drive.permissions.create({
        fileId: targetFileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
        fields: 'id',
      });
    } catch (permError) {
      // Permission might already exist, continue anyway
      console.log('Permission may already exist:', permError.message);
    }

    // Get the file info with the shareable link
    const file = await drive.files.get({
      fileId: targetFileId,
      fields: 'id, name, webViewLink, webContentLink, thumbnailLink, mimeType',
    });

    // Generate different types of links for video.js compatibility
    const directLink = `https://drive.google.com/uc?export=download&id=${targetFileId}`;
    const embedLink = `https://drive.google.com/file/d/${targetFileId}/preview`;
    const streamLink = `https://drive.google.com/uc?export=download&confirm=t&id=${targetFileId}`;

    res.status(200).json({
      success: true,
      data: {
        id: file.data.id,
        name: file.data.name,
        mimeType: file.data.mimeType,
        webViewLink: file.data.webViewLink,
        webContentLink: file.data.webContentLink,
        directLink: directLink,
        embedLink: embedLink,
        streamLink: streamLink,
        thumbnailLink: file.data.thumbnailLink,
        // Video.js compatible sources
        videoJsSource: {
          src: directLink,
          type: 'video/mp4',
        },
      },
    });
  } catch (error) {
    console.error('Google Drive share link error:', error);
    
    if (error.message.includes('credential')) {
      return res.status(500).json({ 
        error: 'Google Drive authentication failed. Please check your credentials.',
        details: error.message 
      });
    }

    if (error.code === 404) {
      return res.status(404).json({ 
        error: 'File not found',
        details: 'The specified file ID does not exist or you do not have access to it.'
      });
    }

    res.status(500).json({ 
      error: 'Failed to get share link from Google Drive',
      details: error.message 
    });
  }
}
