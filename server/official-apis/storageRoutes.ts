import { Router, json } from 'express';
import multer from 'multer';
import { StorageService } from '../services/storage_service.js';

const router: Router = Router();

// Configure multer for memory storage (files kept as Buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 50MB max
  },
});

// Allowed file extensions by category
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'];
const ALLOWED_EXTENSIONS = [...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_DOCUMENT_EXTENSIONS];

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

function sanitizeFileName(filename: string): string {
  const extension = getFileExtension(filename);
  const nameWithoutExt = filename.slice(0, filename.length - extension.length);

  const sanitized = nameWithoutExt
    .replace(/\.\./g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\x20-\x7E]/g, ''); // Remove non-ASCII characters

  // If name becomes empty after removing non-ASCII chars, use a fallback
  const finalName = sanitized.length > 0 ? sanitized : 'file';
  return finalName + extension;
}

/**
 * POST /api/storage/upload
 * Upload a file to Supabase Storage.
 * Form fields: file (multipart), folder (optional string), bucketSuffix (optional string)
 */
router.post('/upload', upload.single('file'), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const originalName = req.file.originalname || 'unnamed';
    const extension = getFileExtension(originalName);

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return res.status(400).json({
        success: false,
        error: `File type "${extension}" is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }

    const folder = (req.body.folder as string) || 'uploads';
    const bucketSuffix = req.body.bucketSuffix as string | undefined;
    const sanitizedName = sanitizeFileName(originalName);
    const timestamp = Date.now();
    const filePath = `${folder}/${timestamp}_${sanitizedName}`;

    const service = new StorageService(req.supabase);

    const result = await service.upload(
      filePath,
      req.file.buffer,
      req.file.mimetype,
      bucketSuffix,
    );

    res.json({
      success: true,
      data: {
        url: result.publicUrl,
        filePath: result.filePath,
        bucket: result.bucket,
        fileName: sanitizedName,
        size: req.file.size,
        contentType: req.file.mimetype,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Upload failed' });
  }
});

/**
 * POST /api/storage/delete
 * Delete files from Supabase Storage.
 * Body: { filePaths: string[], bucketSuffix?: string }
 */
router.post('/delete', json(), async (req: any, res: any) => {
  try {
    const { filePaths, bucketSuffix } = req.body;

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ success: false, error: 'filePaths must be a non-empty array' });
    }

    const service = new StorageService(req.supabase);
    const result = await service.delete(filePaths, bucketSuffix);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Delete failed' });
  }
});

export default router;
