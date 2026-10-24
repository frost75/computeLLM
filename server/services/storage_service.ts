import { SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '../_core/env.js';

export interface UploadResult {
  publicUrl: string;
  filePath: string;
  bucket: string;
}

export interface DeleteResult {
  deleted: string[];
}

export class StorageService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  /**
   * Get the bucket name based on corpId and optional suffix.
   * Default pattern: {corpId}-images
   */
  private getBucketName(suffix: string = 'images'): string {
    return ENV.bucketName;
  }

  /**
   * Upload a file to Supabase Storage.
   * Returns the standardized public URL.
   */
  async upload(
    filePath: string,
    fileBuffer: Buffer,
    contentType: string,
    bucketSuffix?: string,
    upsert: boolean = true,
  ): Promise<UploadResult> {
    const bucket = this.getBucketName(bucketSuffix);

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType,
        upsert,
      });

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    const publicUrl = `/storage/v1/object/public/${bucket}/${data.path}`;
    return { publicUrl, filePath: data.path, bucket };
  }

  /**
   * Delete one or more files from Supabase Storage.
   */
  async delete(filePaths: string[], bucketSuffix?: string): Promise<DeleteResult> {
    const bucket = this.getBucketName(bucketSuffix);

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .remove(filePaths);

    if (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }

    const deleted = (data || []).map((item: any) => item.name);
    return { deleted };
  }

  /**
   * List files in a given folder path.
   */
  async list(folderPath: string = '', bucketSuffix?: string) {
    const bucket = this.getBucketName(bucketSuffix);

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(folderPath, { sortBy: { column: 'created_at', order: 'desc' } });

    if (error) {
      throw new Error(`List failed: ${error.message}`);
    }

    return (data || []).map((file: any) => ({
      name: file.name,
      size: file.metadata?.size,
      contentType: file.metadata?.mimetype,
      createdAt: file.created_at,
      publicUrl: `/storage/v1/object/public/${bucket}/${folderPath ? folderPath + '/' : ''}${file.name}`,
    }));
  }

  /**
   * Get the public URL for a given file path.
   */
  getPublicUrl(filePath: string, bucketSuffix?: string): string {
    const bucket = this.getBucketName(bucketSuffix);
    return `/storage/v1/object/public/${bucket}/${filePath}`;
  }
}
