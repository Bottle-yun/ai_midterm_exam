"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { Play, Pause, RotateCcw, XCircle, Heart, Trophy, Clock, User, Sparkles, Volume2, VolumeX } from "lucide-react";

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  isRed: boolean;
  active: boolean;
}

interface ScoreItem {
  name: string;
  timeStr: string;
  totalSeconds: number;
  date?: string;
}

// 6가지 파스텔/연한 색상 정의
const BRICK_COLORS = [
  { name: "연한 빨강", hex: "#fca5a5", border: "#f87171", isRed: true },
  { name: "연한 주황", hex: "#fdba74", border: "#fb923c", isRed: false },
  { name: "연한 노랑", hex: "#fde047", border: "#facc15", isRed: false },
  { name: "연한 파랑", hex: "#93c5fd", border: "#60a5fa", isRed: false },
  { name: "연한 녹색", hex: "#86efac", border: "#4ade80", isRed: false },
  { name: "연한 보라", hex: "#d8b4fe", border: "#c084fc", isRed: false },
];

export default function BrickBreakerApp() {
  // 화면 상태: 'lobby' (이름 입력 및 대기) | 'countdown' (3,2,1 카운트) | 'playing' (게임 진행) | 'clear' (성공) | 'gameover' (실패)
  const [gameState, setGameState] = useState<"lobby" | "countdown" | "playing" | "clear" | "gameover">("lobby");
  const [userName, setUserName] = useState("");
  const [lives, setLives] = useState(3);
  const [redClearedCount, setRedClearedCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [topScores, setTopScores] = useState<ScoreItem[]>([]);
  const [loadingScores, setLoadingScores] = useState(false);

  // 캔버스 및 오디오 ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // 게임 내부 물리 상태 관리 ref (리렌더링 무관하게 requestAnimationFrame에서 유지)
  const gameRef = useRef({
    paddleX: 350,
    paddleW: 100,
    paddleH: 14,
    paddleSpeed: 8,
    ballX: 400,
    ballY: 450,
    ballR: 8,
    ballVx: 4,
    ballVy: -4,
    bricks: [] as Brick[],
    leftPressed: false,
    rightPressed: false,
    redCleared: 0,
    lives: 3,
    elapsedSeconds: 0,
    running: false,
    paused: false,
    reqId: 0,
    touchStartX: 0,
  });

  // 효과음 생성기 (Web Audio API 활용 - 부드러운 타격음)
  const playHitSound = useCallback((frequency = 440) => {
    try {
      if (typeof window === "undefined") return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      // 오디오 컨텍스트 에러 방지
    }
  }, []);

  // 상위 점수 불러오기 (오직 구글 시트 데이터만 사용)
  const fetchTopScores = useCallback(async () => {
    try {
      setLoadingScores(true);
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.top3 && Array.isArray(data.top3)) {
          setTopScores(data.top3);
        } else {
          setTopScores([]);
        }
      }
    } catch {
      setTopScores([]);
    } finally {
      setLoadingScores(false);
    }
  }, []);

  useEffect(() => {
    fetchTopScores();
  }, [fetchTopScores]);

  // 분:초 문자열 포맷팅 (00:00)
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 게임 타이머
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === "playing" && !isPaused) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1;
          gameRef.current.elapsedSeconds = next;
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, isPaused]);

  // 배경음악 제어
  useEffect(() => {
    if (!audioRef.current) return;
    if (gameState === "playing" && !isPaused) {
      audioRef.current.volume = 0.25; // 볼륨이 너무 크지 않도록 25% 설정
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [gameState, isPaused]);

  // 블록 초기화 로직 (5행 x 8열 = 40개, 연한 빨강 30% 배치: 40 * 0.3 = 12개)
  const generateBricks = useCallback(() => {
    const rows = 5;
    const cols = 8;
    const total = rows * cols; // 40
    const redCount = Math.round(total * 0.3); // 12개

    // 12개의 red와 28개의 other 생성 후 셔플
    const colorIndices: number[] = [];
    for (let i = 0; i < redCount; i++) colorIndices.push(0); // 연한 빨강 index: 0
    for (let i = 0; i < total - redCount; i++) {
      // 1 ~ 5 중에서 랜덤 선택
      const randNonRed = Math.floor(Math.random() * 5) + 1;
      colorIndices.push(randNonRed);
    }

    // Fisher-Yates 셔플
    for (let i = colorIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colorIndices[i], colorIndices[j]] = [colorIndices[j], colorIndices[i]];
    }

    const bricks: Brick[] = [];
    const brickW = 86;
    const brickH = 26;
    const padding = 10;
    const offsetTop = 40;
    const offsetLeft = 20;

    let index = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const colorData = BRICK_COLORS[colorIndices[index]];
        bricks.push({
          x: offsetLeft + c * (brickW + padding),
          y: offsetTop + r * (brickH + padding),
          w: brickW,
          h: brickH,
          color: colorData.hex,
          isRed: colorData.isRed,
          active: true,
        });
        index++;
      }
    }
    return bricks;
  }, []);

  // 게임 시작 트리거
  const handleStartGame = () => {
    if (!userName.trim()) {
      alert("사용자 이름을 입력해 주세요!");
      return;
    }

    // 기본 상태 초기화
    setLives(3);
    setRedClearedCount(0);
    setElapsedSeconds(0);
    setIsPaused(false);

    // 내부 ref 초기화
    gameRef.current.lives = 3;
    gameRef.current.redCleared = 0;
    gameRef.current.bricks = generateBricks();
    gameRef.current.paddleX = 350;
    gameRef.current.ballX = 400;
    gameRef.current.ballY = 430;
    gameRef.current.ballVx = (Math.random() > 0.5 ? 1 : -1) * 4;
    gameRef.current.ballVy = -4.5;
    gameRef.current.paused = false;

    // 카운트다운 진입 (3, 2, 1)
    setCountdown(3);
    setGameState("countdown");
  };

  // 카운트다운 처리 (3, 2, 1 카운트 후 플레이 시작)
  useEffect(() => {
    if (gameState !== "countdown") return;
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setGameState("playing");
      gameRef.current.running = true;
    }
  }, [gameState, countdown]);

  // 점수 등록 (구글 스프레드시트 연동)
  const submitScore = useCallback(
    async (finalSeconds: number) => {
      try {
        const finalTimeStr = formatTime(finalSeconds);
        const payload = {
          name: userName,
          timeStr: finalTimeStr,
          finishtime: finalTimeStr,
          totalSeconds: finalSeconds,
        };

        const res = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.top3 && Array.isArray(data.top3)) {
            setTopScores(data.top3);
          }
        }
      } catch (err) {
        console.error("점수 등록 오류:", err);
      }
    },
    [userName]
  );

  // 성공 미션 트리거
  const handleGameClear = useCallback(() => {
    gameRef.current.running = false;
    setGameState("clear");

    // 축하 폭죽 효과 (canvas-confetti)
    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
      setTimeout(() => {
        confetti({
          particleCount: 80,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
        });
        confetti({
          particleCount: 80,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
        });
      }, 300);
    } catch {}

    // 점수 저장 요청 (최신 초 값 전달)
    const finalSec = gameRef.current.elapsedSeconds;
    submitScore(finalSec);
  }, [submitScore]);

  // 게임 오버 트리거
  const handleGameOver = useCallback(() => {
    gameRef.current.running = false;
    setGameState("gameover");
  }, []);

  // 일시정지 토글
  const togglePause = () => {
    if (gameState !== "playing") return;
    setIsPaused((prev) => {
      gameRef.current.paused = !prev;
      return !prev;
    });
  };

  // 다시 시작 (현재 입력된 이름 그대로 즉시 게임 재실행)
  const handleRestart = () => {
    gameRef.current.running = false;
    cancelAnimationFrame(gameRef.current.reqId);

    // 기본 게임 상태 초기화
    setLives(3);
    setRedClearedCount(0);
    setElapsedSeconds(0);
    setIsPaused(false);

    // 내부 ref 초기화
    gameRef.current.lives = 3;
    gameRef.current.redCleared = 0;
    gameRef.current.bricks = generateBricks();
    gameRef.current.paddleX = 350;
    gameRef.current.ballX = 400;
    gameRef.current.ballY = 430;
    gameRef.current.ballVx = (Math.random() > 0.5 ? 1 : -1) * 4;
    gameRef.current.ballVy = -4.5;
    gameRef.current.paused = false;

    // 카운트다운(3, 2, 1) 후 즉시 게임 재실행
    setCountdown(3);
    setGameState("countdown");
  };

  // 게임 종료 (로비로 나가기)
  const handleQuit = () => {
    gameRef.current.running = false;
    cancelAnimationFrame(gameRef.current.reqId);
    setGameState("lobby");
    setIsPaused(false);
  };

  // 키보드 이벤트 (PC 버전: 좌우 방향키로만 패들 이동)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "Left") {
        gameRef.current.leftPressed = true;
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        gameRef.current.rightPressed = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "Left") {
        gameRef.current.leftPressed = false;
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        gameRef.current.rightPressed = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 모바일 터치 스와이프 제어
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      gameRef.current.touchStartX = e.touches[0].clientX;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      const touchX = e.touches[0].clientX;
      const diff = touchX - gameRef.current.touchStartX;
      gameRef.current.touchStartX = touchX;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;

      gameRef.current.paddleX = Math.max(
        0,
        Math.min(canvas.width - gameRef.current.paddleW, gameRef.current.paddleX + diff * scaleX * 1.2)
      );
    }
  };

  // 메인 게임 루프 (Canvas Rendering)
  useEffect(() => {
    if (gameState !== "playing") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const gameLoop = () => {
      if (!gameRef.current.paused) {
        const g = gameRef.current;
        const width = canvas.width;
        const height = canvas.height;

        // 1. 패들 이동 (PC 방향키)
        if (g.leftPressed && g.paddleX > 0) {
          g.paddleX -= g.paddleSpeed;
        }
        if (g.rightPressed && g.paddleX < width - g.paddleW) {
          g.paddleX += g.paddleSpeed;
        }

        // 2. 공 이동
        g.ballX += g.ballVx;
        g.ballY += g.ballVy;

        // 3. 벽면 충돌 (좌, 우, 상)
        if (g.ballX - g.ballR <= 0) {
          g.ballX = g.ballR;
          g.ballVx = Math.abs(g.ballVx);
          playHitSound(300);
        } else if (g.ballX + g.ballR >= width) {
          g.ballX = width - g.ballR;
          g.ballVx = -Math.abs(g.ballVx);
          playHitSound(300);
        }

        if (g.ballY - g.ballR <= 0) {
          g.ballY = g.ballR;
          g.ballVy = Math.abs(g.ballVy);
          playHitSound(350);
        }

        // 4. 패들 충돌
        const paddleTop = height - 40;
        if (
          g.ballY + g.ballR >= paddleTop &&
          g.ballY - g.ballR <= paddleTop + g.paddleH &&
          g.ballX >= g.paddleX &&
          g.ballX <= g.paddleX + g.paddleW &&
          g.ballVy > 0
        ) {
          // 패들의 맞은 위치에 따라 각도 변화
          const hitOffset = (g.ballX - (g.paddleX + g.paddleW / 2)) / (g.paddleW / 2);
          g.ballVx = hitOffset * 5.5;
          g.ballVy = -Math.abs(g.ballVy);
          playHitSound(520);
        }

        // 5. 바닥으로 떨어진 경우 (생명 감소)
        if (g.ballY - g.ballR > height) {
          g.lives -= 1;
          setLives(g.lives);
          if (g.lives <= 0) {
            handleGameOver();
            return;
          } else {
            // 공 & 패들 위치 리셋
            g.ballX = width / 2;
            g.ballY = paddleTop - 20;
            g.ballVx = (Math.random() > 0.5 ? 1 : -1) * 4;
            g.ballVy = -4.5;
            g.paddleX = (width - g.paddleW) / 2;
          }
        }

        // 6. 블록 충돌 감지
        for (let i = 0; i < g.bricks.length; i++) {
          const b = g.bricks[i];
          if (!b.active) continue;

          if (
            g.ballX + g.ballR > b.x &&
            g.ballX - g.ballR < b.x + b.w &&
            g.ballY + g.ballR > b.y &&
            g.ballY - g.ballR < b.y + b.h
          ) {
            b.active = false;
            g.ballVy = -g.ballVy;
            playHitSound(b.isRed ? 700 : 480);

            // 연한 빨강색 블록 체크
            if (b.isRed) {
              g.redCleared += 1;
              setRedClearedCount(g.redCleared);

              // 연한 빨강 3개 제거 시 미션 성공 종료!
              if (g.redCleared >= 3) {
                handleGameClear();
                return;
              }
            }
            break;
          }
        }

        // 7. 캔버스 렌더링
        ctx.clearRect(0, 0, width, height);

        // 배경 그리드 미세 효과
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, 0, width, height);

        // 블록 그리기
        for (const b of g.bricks) {
          if (!b.active) continue;
          ctx.beginPath();
          ctx.roundRect(b.x, b.y, b.w, b.h, 6);
          ctx.fillStyle = b.color;
          ctx.fill();

          // 연한 빨강 목표 블록 강조 테두리
          if (b.isRed) {
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = "#ef4444";
            ctx.stroke();
          } else {
            ctx.lineWidth = 1;
            ctx.strokeStyle = "rgba(0,0,0,0.06)";
            ctx.stroke();
          }
        }

        // 패들 그리기
        ctx.beginPath();
        ctx.roundRect(g.paddleX, paddleTop, g.paddleW, g.paddleH, 7);
        ctx.fillStyle = "#0284c7"; // 인천대 느낌의 횃불 블루
        ctx.fill();
        ctx.strokeStyle = "#0369a1";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 공 그리기
        ctx.beginPath();
        ctx.arc(g.ballX, g.ballY, g.ballR, 0, Math.PI * 2);
        ctx.fillStyle = "#f97316"; // 횃불 오렌지/불꽃 색상
        ctx.fill();
        ctx.strokeStyle = "#c2410c";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      animId = requestAnimationFrame(gameLoop);
      gameRef.current.reqId = animId;
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [gameState, playHitSound, handleGameClear, handleGameOver]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-sky-100 to-indigo-100 flex flex-col items-center justify-center p-3 sm:p-6 font-sans text-slate-800">
      {/* 배경 음악 오디오 태그 */}
      <audio ref={audioRef} src="/Hyper_Speed_Run.mp3" loop preload="auto" />

      {/* 헤더 & 앱 타이틀 */}
      <header className="w-full max-w-4xl flex items-center justify-center sm:justify-start mb-3 px-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-blue-700 via-sky-600 to-indigo-600 bg-clip-text text-transparent">
          INU 벽돌깨기
        </h1>
      </header>

      {/* 메인 게임 및 화면 컨테이너 */}
      <div className="w-full max-w-4xl bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-sky-100 p-4 sm:p-6 flex flex-col items-center relative overflow-hidden">
        {/* 1. 로비 화면 (마스코트 이미지, 제작자 정보, 이름 입력 칸, 게임 시작 버튼, 랭킹표 - 슬라이드 다운 효과 적용) */}
        {gameState === "lobby" && (
          <div className="w-full flex flex-col items-center py-6 text-center animate-slide-down">
            {/* 인천대학교 마스코트 횃불이 이미지 배치 (테두리 없이 적절히 키운 크기) */}
            <div className="relative w-48 h-48 sm:w-56 sm:h-56 mb-4 transform hover:scale-105 transition-transform duration-300">
              <Image src="/Mascot.jpg" alt="인천대학교 마스코트 횃불이" fill priority className="object-contain" />
            </div>

            {/* 제작자 텍스트 (테두리 및 배경 제거) */}
            <p className="mb-6 text-sm sm:text-base font-bold text-slate-700 tracking-wide">
              해양학과 | 202200449 | 윤병윤
            </p>

            {/* 사용자 이름 입력란 */}
            <div className="w-full max-w-xs mb-5">
              <label htmlFor="username" className="block text-left text-xs font-semibold text-slate-600 mb-1.5">
                도전자 이름
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  maxLength={10}
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="이름을 입력하세요"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm shadow-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleStartGame();
                  }}
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              </div>
            </div>

            {/* 게임 시작 버튼 */}
            <button
              onClick={handleStartGame}
              className="w-full max-w-xs py-3 px-6 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2 text-base"
            >
              <Play className="w-5 h-5 fill-white" />
              게임 시작하기
            </button>

            {/* Top 3 랭킹 디스플레이 */}
            <div className="mt-8 w-full max-w-md bg-slate-50 rounded-xl p-4 border border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-center gap-1.5">
                <Trophy className="w-4 h-4 text-amber-500" />
                명예의 전당 Top 3
              </h3>
              {loadingScores ? (
                <p className="text-xs text-slate-400 py-2">랭킹 불러오는 중...</p>
              ) : topScores.length > 0 ? (
                <div className="space-y-2">
                  {topScores.map((score, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs sm:text-sm bg-white px-3 py-2 rounded-lg border border-slate-100 shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            idx === 0
                              ? "bg-amber-400 text-white"
                              : idx === 1
                              ? "bg-slate-300 text-slate-700"
                              : "bg-amber-700/60 text-white"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-slate-800">{score.name}</span>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-sky-600 font-bold">
                        <Clock className="w-3.5 h-3.5" />
                        {score.timeStr}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 py-2">아직 기록이 없습니다. 첫 번째 챔피언이 되어보세요!</p>
              )}
            </div>
          </div>
        )}

        {/* 2. 카운트다운 오버레이 및 3. 게임 플레이/성공/실패 뷰 (게임 시작 시 슬라이드 다운 효과 적용) */}
        {gameState !== "lobby" && (
          <div className="w-full flex flex-col items-center animate-slide-down">
            {/* 상단 게임 상태 정보바 (반응형 폰트 및 자동 줄바꿈 최적화) */}
            <div className="w-full flex items-center justify-between gap-1 sm:gap-2 mb-3 px-2 sm:px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
                {/* 플레이어 */}
                <span className="font-semibold text-slate-700 flex items-center gap-1 whitespace-nowrap">
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-sky-600 shrink-0" />
                  <span className="truncate max-w-[80px] sm:max-w-[140px]">{userName}</span>
                </span>

                {/* 남은 생명 (3번) */}
                <div className="flex items-center gap-0.5 sm:gap-1 text-red-500 whitespace-nowrap">
                  <span className="text-[11px] sm:text-xs font-bold text-slate-600 mr-0.5">생명:</span>
                  {[...Array(3)].map((_, i) => (
                    <Heart
                      key={i}
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${i < lives ? "fill-red-500 text-red-500" : "text-slate-300"}`}
                    />
                  ))}
                </div>

                {/* 연한 빨강 블록 제거 미션 현황 */}
                <div className="flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 bg-red-100 rounded-md border border-red-200 text-red-700 font-bold text-[11px] sm:text-xs whitespace-nowrap shrink-0">
                  <span>연한 빨강:</span>
                  <span className="text-red-900 font-extrabold">{redClearedCount} / 3</span>
                </div>
              </div>

              {/* 진행 시간 (분:초 형식) */}
              <div className="flex items-center gap-1 sm:gap-1.5 font-mono font-bold text-slate-700 bg-white px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md border border-slate-200 shadow-2xs text-[11px] sm:text-sm whitespace-nowrap shrink-0">
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-sky-500 shrink-0" />
                <span>시간: {formatTime(elapsedSeconds)}</span>
              </div>
            </div>

            {/* 캔버스 및 오버레이 래퍼 */}
            <div className="relative w-full max-w-[800px] aspect-[800/500] min-h-[260px] sm:min-h-[360px] bg-slate-900 rounded-xl overflow-hidden shadow-inner border border-slate-300 touch-none">
              <canvas
                ref={canvasRef}
                width={800}
                height={500}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                className="w-full h-full block bg-slate-50 cursor-grab active:cursor-grabbing"
              />

              {/* 준비 카운트다운 3, 2, 1 오버레이 */}
              {gameState === "countdown" && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-center text-white z-20 animate-fade-in">
                  <div className="text-7xl font-black text-amber-400 animate-bounce">{countdown}</div>
                  <p className="mt-3 text-lg font-bold tracking-wide">준비하세요!</p>
                </div>
              )}

              {/* 일시 정지 오버레이 */}
              {isPaused && gameState === "playing" && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-white z-20">
                  <h3 className="text-3xl font-extrabold mb-2 text-amber-400">일시 정지됨</h3>
                  <p className="text-sm text-slate-300 mb-4">게임을 계속하려면 일시정지 해제 버튼을 눌러주세요.</p>
                  <button
                    onClick={togglePause}
                    className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 rounded-xl font-bold text-sm shadow-md transition"
                  >
                    게임 계속하기
                  </button>
                </div>
              )}

              {/* 게임 클리어 미션 완료 모달 (위에서 아래로 슬라이드 다운 효과) */}
              {gameState === "clear" && (
                <div className="absolute inset-0 bg-blue-950/90 backdrop-blur-sm flex flex-col items-center justify-center text-white z-30 p-2 sm:p-6 text-center animate-slide-down overflow-y-auto">
                  <div className="w-8 h-8 sm:w-14 sm:h-14 rounded-full bg-amber-400 flex items-center justify-center mb-1 sm:mb-2 shadow-lg shrink-0">
                    <Trophy className="w-5 h-5 sm:w-8 sm:h-8 text-blue-900" />
                  </div>
                  <h3 className="text-base sm:text-2xl md:text-3xl font-extrabold text-amber-300 mb-0.5 sm:mb-1 leading-tight whitespace-nowrap">
                    축하합니다! 미션 완료!
                  </h3>
                  <p className="text-[11px] sm:text-sm text-slate-200 mb-1.5 sm:mb-4 px-1 leading-snug">
                    연한 빨강 블록 3개를 성공적으로 모두 제거했습니다!
                  </p>

                  <div className="bg-white/10 px-3 py-1 sm:px-6 sm:py-2.5 rounded-xl border border-white/20">
                    <span className="text-[10px] sm:text-xs text-slate-300 block mb-0.5">최종 완료 시간</span>
                    <span className="text-lg sm:text-3xl font-mono font-black text-emerald-300 tracking-wider">
                      {formatTime(elapsedSeconds)}
                    </span>
                  </div>
                </div>
              )}

              {/* 게임 오버 (미션 실패) 모달 (위에서 아래로 슬라이드 다운 효과) */}
              {gameState === "gameover" && (
                <div className="absolute inset-0 bg-red-950/90 backdrop-blur-sm flex flex-col items-center justify-center text-white z-30 p-2 sm:p-6 text-center animate-slide-down overflow-y-auto">
                  <div className="w-8 h-8 sm:w-14 sm:h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-1 sm:mb-2 border-2 border-red-500 shrink-0">
                    <XCircle className="w-5 h-5 sm:w-8 sm:h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg sm:text-3xl md:text-4xl font-extrabold text-red-400 leading-tight">
                    게임 오버
                  </h3>
                </div>
              )}
            </div>

            {/* 컨트롤 바: 게임 멈춤 / 다시 시작 / 게임 종료 버튼 */}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
              {/* 중간 일시정지 / 재개 버튼 */}
              <button
                onClick={togglePause}
                disabled={gameState !== "playing"}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl shadow transition flex items-center gap-1.5"
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                {isPaused ? "계속하기" : "일시정지"}
              </button>

              {/* 다시 시작 버튼 (이름 작성 화면으로 이동) */}
              <button
                onClick={handleRestart}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                다시 시작
              </button>

              {/* 게임 종료 버튼 */}
              <button
                onClick={handleQuit}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow transition flex items-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                게임 종료
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 푸터 */}
      <footer className="mt-4 text-center text-xs text-slate-500">
        © 2026 인천대학교 (INU) 벽돌깨기 | AI코딩을활용한창의적앱개발
      </footer>
    </main>
  );
}
