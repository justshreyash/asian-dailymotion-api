import { NextRequest, NextResponse } from 'next/server';
import { getAllDmAccounts, addDmAccount, toggleDmAccountActive, deleteDmAccount } from '@/lib/db/queries';
import { verifyAdminRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const rawAccounts = await getAllDmAccounts();
    // Mask sensitive api_secret and access_token before sending to frontend
    const accounts = rawAccounts.map(acc => ({
      ...acc,
      api_secret: acc.api_secret ? '••••••••••••' : '',
      access_token: acc.access_token ? '••••••••••••' : null,
    }));

    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { label, apiKey, apiSecret } = body;

    if (!label || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'Missing required fields (label, apiKey, apiSecret)' }, { status: 400 });
    }

    const account = await addDmAccount({
      label: label.trim(),
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
    });

    return NextResponse.json({
      success: true,
      account: account ? {
        ...account,
        api_secret: '••••••••••••',
        access_token: null,
      } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, isActive } = body;

    if (id == null || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Invalid parameters (id and isActive required)' }, { status: 400 });
    }

    await toggleDmAccountActive(id, isActive);
    return NextResponse.json({ success: true, message: `Account #${id} set to ${isActive ? 'active' : 'inactive'}` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const { dbRun } = await import('@/lib/db/client');
    const { resetHoldVideos } = await import('@/lib/db/queries');
    await dbRun("UPDATE dm_accounts SET is_active = 1 WHERE status = 'active'");
    const resetCount = await resetHoldVideos();
    return NextResponse.json({ success: true, message: `All healthy swarm drives activated and ${resetCount} hold videos released.` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '', 10);

    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    await deleteDmAccount(id);
    return NextResponse.json({ success: true, message: `Account #${id} deleted` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
