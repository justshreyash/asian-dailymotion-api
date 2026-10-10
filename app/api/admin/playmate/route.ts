import { NextRequest, NextResponse } from 'next/server';
import { uploadEligibleToPlaymate } from '../../../../lib/pipeline/playmate-upload';
import { PlaymateClient } from '../../../../lib/playmate/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const playmate = new PlaymateClient();
    const accountInfo = await playmate.getAccountInfo();
    const files = await playmate.listFiles(playmate.getFolderId(), 1, 10);

    return NextResponse.json({
      status: 'ok',
      folderId: playmate.getFolderId(),
      account: accountInfo,
      recentFolderFiles: files,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ? parseInt(body.limit, 10) : (body.all ? undefined : 1);
    const videoIds = Array.isArray(body.videoIds) ? body.videoIds : undefined;

    const result = await uploadEligibleToPlaymate({
      limit,
      videoIds,
    });

    return NextResponse.json({
      status: 'success',
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
