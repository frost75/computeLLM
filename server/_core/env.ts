export const ENV = {
    aiappPlatformOrigin: process.env.AI_APP_PLATFORM_ORIGIN__ ?? 'https://ai-app.dingtalk.com',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
    appId: process.env.APP_ID ?? '',
    corpId: process.env.CORP_ID ?? '',
    bucketName: process.env.BUCKET_NAME ?? '',
}