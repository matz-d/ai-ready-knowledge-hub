import dotenv from 'dotenv';

/**
 * scripts/ 経由のローカル実行で `.env.local` を読み込む。
 * Cloud Run 等の本番ランタイムでは scripts/ を読み込まないため、
 * このファイルが本番にバンドルされる懸念はない。
 */
dotenv.config({ path: '.env.local' });
