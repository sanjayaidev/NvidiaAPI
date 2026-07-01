# Google Drive Video Integration

This guide explains how to set up and use the Google Drive integration for uploading and sharing videos with Video.js player.

## Features

- **Public API Endpoints**: Anyone can use the endpoints to upload videos and get shareable links
- **Video.js Integration**: Built-in HTML5 video player with Video.js for optimal playback
- **Automatic Public Sharing**: Files are automatically made publicly accessible
- **Multiple Link Formats**: Get direct links, embed links, and streaming links compatible with video players

## Setup

### 1. Install Dependencies

```bash
npm install googleapis
```

### 2. Configure Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Drive API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Drive API" and enable it

### 3. Create Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in the service account details:
   - Name: `video-uploader` (or your preferred name)
   - Description: "Service account for video uploads"
4. Click "Create and Continue"
5. Skip granting roles (we'll use domain-wide delegation if needed)
6. Click "Done"

### 4. Generate Service Account Key

1. Click on the newly created service account
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Select **JSON** format
5. Download the JSON file

### 5. Configure Environment Variables

Copy the downloaded JSON file contents and add to your `.env.local`:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

**Important**: 
- Replace `\n` in the private key with actual newlines when copying from JSON
- Or keep the escaped format as shown above

## API Endpoints

### Upload Video

**Endpoint**: `POST /api/drive/upload`

**Request Body**:
```json
{
  "file": "base64-encoded-file-data",
  "filename": "my-video.mp4",
  "folderId": "optional-folder-id"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "file-id-from-google-drive",
    "name": "my-video.mp4",
    "webViewLink": "https://drive.google.com/file/d/.../view",
    "webContentLink": "https://drive.google.com/uc?id=...&export=download",
    "directLink": "https://drive.google.com/uc?export=download&id=...",
    "embedLink": "https://drive.google.com/file/d/.../preview",
    "thumbnailLink": "https://lh3.googleusercontent.com/...",
    "videoJsSource": {
      "src": "https://drive.google.com/uc?export=download&id=...",
      "type": "video/mp4"
    }
  }
}
```

### Get Share Link

**Endpoint**: `GET /api/drive/share?fileId=FILE_ID`

Or POST with body:
```json
{
  "fileId": "file-id-from-google-drive"
}
```

**Response**: Same format as upload endpoint

## Usage Examples

### Using the HTML Interface

1. Navigate to `/video-player.html`
2. Click "Choose Video File" to select a video
3. Click "Upload to Google Drive"
4. The video will automatically play in the Video.js player
5. You can also load existing videos by clicking "Load from File ID"

### Programmatic Upload (JavaScript)

```javascript
// Read file as base64
const file = document.getElementById('videoInput').files[0];
const reader = new FileReader();

reader.onload = async (e) => {
  const base64Data = e.target.result.split(',')[1]; // Remove data URL prefix
  
  const response = await fetch('/api/drive/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file: base64Data,
      filename: file.name,
    }),
  });
  
  const result = await response.json();
  
  // Use with Video.js
  const player = videojs('my-video');
  player.src({
    src: result.data.directLink,
    type: 'video/mp4',
  });
};

reader.readAsDataURL(file);
```

### Using the Server-side Library

```javascript
import { uploadVideo, getShareableLink } from './lib/googleDrive';

// Upload a video
const fs = require('fs');
const fileBuffer = fs.readFileSync('./path/to/video.mp4');

const result = await uploadVideo(fileBuffer, {
  filename: 'my-awesome-video.mp4',
  mimeType: 'video/mp4',
});

console.log('Direct link:', result.directLink);
console.log('Video.js source:', result.videoJsSource);

// Get shareable link for existing file
const shareInfo = await getShareableLink('existing-file-id');
console.log('Share link:', shareInfo.webViewLink);
```

### Video.js Integration

```html
<video
  id="my-video"
  class="video-js vjs-default-skin"
  controls
  preload="auto"
  data-setup='{}'
>
  <source src="" type="video/mp4" />
</video>

<script>
  const player = videojs('my-video');
  
  // After getting the upload response
  player.src({
    src: result.data.directLink,
    type: 'video/mp4',
  });
  
  player.play();
</script>
```

## Link Types Explained

| Link Type | Description | Best For |
|-----------|-------------|----------|
| `directLink` | Direct download/stream link | Video.js, HTML5 video players |
| `webViewLink` | Google Drive web viewer | Sharing with users |
| `embedLink` | Embeddable iframe preview | Embedding in websites |
| `webContentLink` | Original content link | Direct downloads |
| `streamLink` | Optimized streaming link | Adaptive streaming |

## Security Notes

- Files uploaded are automatically made **publicly accessible** (anyone with the link can view)
- Service account should only have access to specific folders if needed
- Consider implementing rate limiting for public endpoints
- Monitor quota usage in Google Cloud Console

## Quotas and Limits

- Google Drive API has quotas based on your Google Cloud project
- Default: 1,000 requests per 100 seconds per user
- File size limit: 5TB per file
- Consider implementing chunked uploads for large files

## Troubleshooting

### "Authentication failed" error
- Verify service account email is correct
- Ensure private key is properly formatted (with `\n` for newlines)
- Check that Google Drive API is enabled

### "File not found" error
- Verify the file ID is correct
- Ensure service account has access to the file
- Check if file was deleted

### Video doesn't play
- Use `directLink` instead of `webViewLink`
- Ensure file permissions are set to "anyone with link can view"
- Check browser console for CORS errors

## Additional Resources

- [Google Drive API Documentation](https://developers.google.com/drive/api/guides/about-sdk)
- [Video.js Documentation](https://docs.videojs.com/)
- [Service Account Authentication](https://cloud.google.com/docs/authentication/service-keys)
