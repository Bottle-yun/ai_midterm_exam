import { NextResponse } from "next/server";

interface NormalizedScore {
  name: string;
  timeStr: string;
  totalSeconds: number;
  date: string;
}

function normalizeScoreItem(item: any): NormalizedScore {
  let name = String(item.name || "");
  let timeStr = String(item.timeStr || item.finishtime || "");
  let totalSeconds = typeof item.totalSeconds === "number" ? item.totalSeconds : 999999;

  // 구글 시트에서 "00:19" 같은 문자열을 시간/날짜 객체로 변환하여 반환한 경우:
  // "Sat Dec 30 1899 HH:mm:ss GMT+..." 형식으로 넘어옴
  // 여기서 시(H), 분(M), 초(S)에서 원래 게임 시간인 [분(M)과 초(S)] 또는 [시(H)와 분(M)] 파싱
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const p1 = parseInt(timeMatch[1], 10);
    const p2 = parseInt(timeMatch[2], 10);
    const p3 = parseInt(timeMatch[3], 10);

    // 구글 시트 자동 서식의 특성:
    // "00:19" (0분 19초) 입력 시 -> 시: 00, 분: 19, 초: 00 으로 들어가는 현상 처리
    let mins = 0;
    let secs = 0;
    if (p1 === 0 && p2 > 0 && p3 === 0) {
      // 00:19:00 -> 실제 게임 시간은 0분 19초
      mins = 0;
      secs = p2;
    } else if (p1 === 0) {
      mins = p2;
      secs = p3;
    } else {
      mins = p1;
      secs = p2;
    }

    totalSeconds = mins * 60 + secs;
    timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  } else {
    const minSecMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (minSecMatch) {
      const mins = parseInt(minSecMatch[1], 10);
      const secs = parseInt(minSecMatch[2], 10);
      totalSeconds = mins * 60 + secs;
      timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
  }

  return {
    name,
    timeStr,
    totalSeconds,
    date: item.date || "",
  };
}

export async function GET() {
  const googleScriptUrl =
    process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || process.env.GOOGLE_SCRIPT_URL;

  if (!googleScriptUrl) {
    // 구글 시트 URL이 설정되지 않은 경우 빈 배열 반환 (오직 구글 시트 데이터만 반영)
    return NextResponse.json({ success: true, top3: [] });
  }

  try {
    const res = await fetch(googleScriptUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        const cleaned = data.map(normalizeScoreItem);
        // 완료 시간(totalSeconds) 빠른 순 정렬
        cleaned.sort((a, b) => a.totalSeconds - b.totalSeconds);
        return NextResponse.json({ success: true, top3: cleaned.slice(0, 3) });
      }
    }
  } catch (err) {
    console.error("구글 시트 데이터 조회 실패:", err);
  }

  return NextResponse.json({ success: true, top3: [] });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, timeStr, finishtime } = body;
    const finalTime = finishtime || timeStr;

    if (!name || !finalTime) {
      return NextResponse.json({ success: false, error: "이름 또는 시간이 누락되었습니다." }, { status: 400 });
    }

    const googleScriptUrl =
      process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || process.env.GOOGLE_SCRIPT_URL;

    if (!googleScriptUrl) {
      return NextResponse.json(
        { success: false, error: "NEXT_PUBLIC_GOOGLE_SCRIPT_URL이 .env.local에 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    // Google Apps Script는 302 리다이렉트를 수행하므로 redirect: 'follow' 필수
    // 1차 시도: URL 쿼리 파라미터 (GET 전달)
    const saveUrl = new URL(googleScriptUrl);
    saveUrl.searchParams.set("action", "save");
    saveUrl.searchParams.set("name", name);
    saveUrl.searchParams.set("finishtime", finalTime);

    let googleSuccess = false;

    try {
      const getRes = await fetch(saveUrl.toString(), {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
      });
      if (getRes.ok) {
        googleSuccess = true;
      }
    } catch {
      // GET 실패 시 POST 시도
      try {
        const postRes = await fetch(googleScriptUrl, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            finishtime: finalTime,
          }),
        });
        if (postRes.ok) {
          googleSuccess = true;
        }
      } catch (postErr) {
        console.error("구글 시트 POST 전송 실패:", postErr);
      }
    }

    // 최신 구글 시트 랭킹 재조회
    let updatedTop3: NormalizedScore[] = [];
    try {
      const fetchRes = await fetch(googleScriptUrl, {
        cache: "no-store",
        redirect: "follow",
      });
      if (fetchRes.ok) {
        const data = await fetchRes.json();
        if (Array.isArray(data)) {
          const cleaned = data.map(normalizeScoreItem);
          cleaned.sort((a, b) => a.totalSeconds - b.totalSeconds);
          updatedTop3 = cleaned.slice(0, 3);
        }
      }
    } catch {}

    return NextResponse.json({
      success: googleSuccess,
      top3: updatedTop3,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
