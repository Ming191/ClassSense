import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/server/session-service";
import {
  createRoomBodySchema,
  getValidationErrorMessage,
} from "@/lib/request-validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);

    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsedBody = createRoomBodySchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedBody.error) },
        { status: 400 }
      );
    }

    const createResult = await createSession({
      headers: request.headers,
      title: parsedBody.data.title,
      hostName: parsedBody.data.hostName,
      hostEmail: parsedBody.data.hostEmail,
    });

    if ("error" in createResult) {
      return NextResponse.json(
        { error: createResult.error.message },
        { status: createResult.error.status }
      );
    }

    return NextResponse.json(createResult, { status: 201 });
  } catch (error) {
    console.error("Failed to create session", error);
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }
}
