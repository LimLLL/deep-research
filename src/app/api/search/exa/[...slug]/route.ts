import { NextResponse, type NextRequest } from "next/server";
import { EXA_BASE_URL } from "@/constants/urls";
import { proxyFetch } from "@/app/api/utils";

export const runtime = "edge";
export const preferredRegion = [
  "cle1",
  "iad1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1",
  "hnd1",
  "kix1",
];

const API_PROXY_BASE_URL = process.env.EXA_API_BASE_URL || EXA_BASE_URL;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const searchParams = req.nextUrl.searchParams;
  const path = searchParams.getAll("slug");
  searchParams.delete("slug");
  const params = searchParams.toString();

  try {
    let url = `${API_PROXY_BASE_URL}/${decodeURIComponent(path.join("/"))}`;
    if (params) url += `?${params}`;
    const forwardHeaders: HeadersInit = {
      "Content-Type": req.headers.get("Content-Type") || "application/json",
    };
    // Forward whichever auth header the middleware set
    const xApiKey = req.headers.get("x-api-key");
    if (xApiKey) {
      forwardHeaders["x-api-key"] = xApiKey;
    } else {
      forwardHeaders["Authorization"] = req.headers.get("Authorization") || "";
    }
    const payload: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
      body: JSON.stringify(body),
    };
    const response = await proxyFetch(url, payload);
    return new NextResponse(response.body, response);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown proxy error";
    return NextResponse.json(
      { code: 500, message },
      { status: 500 }
    );
  }
}
