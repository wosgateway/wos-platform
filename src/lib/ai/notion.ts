import { Client } from '@notionhq/client';

// Strip whitespace/newlines and accidental surrounding quotes. A token that
// picked up a trailing "\r" or quotes from a Windows .env / CLI paste reaches
// Notion as a malformed header ("Authorization header must use the format
// Bearer <token>").
const token = process.env.NOTION_TOKEN?.trim().replace(/^["']|["']$/g, '');

export const notion = new Client({
  auth: token,
});
