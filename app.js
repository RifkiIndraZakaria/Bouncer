/* ==================================================
   KONFIGURASI SUPABASE (Cloud Save & Leaderboard)
   ================================================== */
      window.SUPABASE_URL = "https://bchwkrttbplnntezdoti.supabase.co";
      window.SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjaHdrcnR0YnBsbm50ZXpkb3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NTEyNjIsImV4cCI6MjEwMTMyNzI2Mn0.7Ty8gCighi9ojnD5aMzax62f-ige160pPmeJ4N-DF5Y";

/* ==================================================
   AUDIO MANAGER
   ================================================== */
      const AudioManager = (function () {
        const SOURCES = {
          bgm: "bgm.mp3",
          bounce: "bounce.mp3",
          coin: "coin.mp3",
          upgrade: "upgrade.mp3",
        };

        // Volume dasar tiap suara (0.0 - 1.0)
        const VOLUME = {
          bgm: 0.35,
          bounce: 0.5,
          coin: 0.6,
          upgrade: 0.7,
        };

        // Jeda minimum antar-play untuk SFX yang sering terpicu
        // (mencegah suara menumpuk saat banyak bola memantul cepat)
        const THROTTLE_MS = {
          bounce: 40,
          coin: 40,
        };

        let muted = localStorage.getItem("ib_muted") === "1";
        const lastPlayed = {};
        const sfxPools = {}; // beberapa instance Audio per efek agar bisa overlap
        const POOL_SIZE = 6;
        let bgmEl = null;
        let unlocked = false;

        function buildPool(key, src) {
          const pool = [];
          for (let i = 0; i < POOL_SIZE; i++) {
            const a = new Audio(src);
            a.preload = "auto";
            a.volume = VOLUME[key] ?? 1;
            a.addEventListener("error", () => {
              // File belum ada / gagal dimuat — abaikan diam-diam
            });
            pool.push(a);
          }
          return pool;
        }

        function init() {
          sfxPools.bounce = buildPool("bounce", SOURCES.bounce);
          sfxPools.coin = buildPool("coin", SOURCES.coin);
          sfxPools.upgrade = buildPool("upgrade", SOURCES.upgrade);

          bgmEl = new Audio(SOURCES.bgm);
          bgmEl.loop = true;
          bgmEl.preload = "auto";
          bgmEl.volume = VOLUME.bgm;
          bgmEl.addEventListener("error", () => {
            // bgm.mp3 belum ada — abaikan diam-diam
          });

          // Browser memblokir autoplay audio sebelum ada interaksi
          // pengguna. Kita "buka kunci" audio pada sentuhan/klik
          // pertama, lalu jalankan musik latar (jika belum di-mute).
          const unlock = () => {
            if (unlocked) return;
            unlocked = true;
            if (!muted) playBgm();
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
          };
          window.addEventListener("pointerdown", unlock, { once: true });
          window.addEventListener("keydown", unlock, { once: true });

          updateMuteButton();
        }

        function playBgm() {
          if (!bgmEl || muted) return;
          const p = bgmEl.play();
          if (p && p.catch) p.catch(() => {});
        }

        function stopBgm() {
          if (!bgmEl) return;
          bgmEl.pause();
        }

        function playSfx(key) {
          if (muted) return;
          const now = performance.now();
          const throttle = THROTTLE_MS[key] || 0;
          if (throttle && lastPlayed[key] && now - lastPlayed[key] < throttle) {
            return;
          }
          lastPlayed[key] = now;

          const pool = sfxPools[key];
          if (!pool) return;
          // Cari instance yang sedang tidak dipakai, atau pakai yang paling lama
          let el = pool.find((a) => a.paused || a.ended);
          if (!el) el = pool[0];
          try {
            el.currentTime = 0;
            const p = el.play();
            if (p && p.catch) p.catch(() => {});
          } catch (e) {
            // abaikan
          }
        }

        function updateMuteButton() {
          const btn = document.getElementById("muteBtn");
          if (btn) btn.textContent = muted ? "🔇" : "🔊";
        }

        function toggleMute() {
          muted = !muted;
          localStorage.setItem("ib_muted", muted ? "1" : "0");
          if (muted) {
            stopBgm();
          } else if (unlocked) {
            playBgm();
          }
          updateMuteButton();
        }

        document.addEventListener("DOMContentLoaded", () => {
          init();
          const btn = document.getElementById("muteBtn");
          if (btn) btn.addEventListener("click", toggleMute);
        });

        return {
          playBounce: () => playSfx("bounce"),
          playCoin: () => playSfx("coin"),
          playUpgrade: () => playSfx("upgrade"),
        };
      })();

/* ==================================================
   MAIN GAME LOGIC
   ================================================== */
      (function () {
        const canvas = document.getElementById("board");
        const ctx = canvas.getContext("2d");
        const boardWrap = canvas.parentElement;
        const hint = document.getElementById("hint");
        const toastEl = document.getElementById("toast");

        let money = 0;
        let availableBalls = 5;
        let ballMultiplier = 1;
        let ballsBought = 0;
        let profitBought = 0;
        let paddlesBought = 0;
        let mergesBought = 0;
        let totalEarned = 0;

        // TAMBAHAN: batas jumlah bola yang boleh "stay" permanen di papan.
        // Awal main cuma 1 bola yang bisa stay selamanya; bola tambahan
        // di luar batas ini cuma "sementara" -- umurnya berkurang tiap kali
        // memantul (kena paddle ATAU dinding kosong), dan setelah mencapai
        // MAX_TEMP_BALL_BOUNCES ia kembali ke stok bola (availableBalls++)
        // untuk di-spawn ulang, bukan hilang total.
        let maxBallStay = 1;
        let maxBallStayBought = 0;
        const MAX_TEMP_BALL_BOUNCES = 5;

        const PADDLE_THICK = 14;
        const PADDLE_LEN = 78;
        const BALL_R = 7;
        const AUTO_SPEED = 0.0055;

        // TAMBAHAN: Properti hitFlash untuk efek kilat saat ditabrak
        let paddles = [
          { side: "top", pos: 0.5, value: 1, auto: true, dir: 1, hitFlash: 0 },
          {
            side: "bottom",
            pos: 0.5,
            value: 1,
            auto: true,
            dir: -1,
            hitFlash: 0,
          },
          { side: "left", pos: 0.5, value: 1, auto: true, dir: 1, hitFlash: 0 },
          {
            side: "right",
            pos: 0.5,
            value: 1,
            auto: true,
            dir: -1,
            hitFlash: 0,
          },
        ];
        let balls = [];
        let floaters = [];

        // TAMBAHAN: Array untuk menampung visual efek partikel
        let particles = [];

        // Basis eksponen upgrade diperbesar supaya jarak (gap) harga
        // antar level pembelian jadi jauh lebih terasa/mahal seiring
        // makin banyak dibeli, dibanding sebelumnya.
        function costAddBall() {
          return Math.round(45 * Math.pow(1.75, ballsBought));
        }
        function costProfit() {
          return Math.round(300 * Math.pow(2.15, profitBought));
        }
        function costAddPaddle() {
          return Math.round(140 * Math.pow(1.85, paddlesBought));
        }
        function costMerge() {
          return Math.round(90 * Math.pow(1.7, mergesBought));
        }
        function costMaxBallStay() {
          return Math.round(500 * Math.pow(2.3, maxBallStayBought));
        }

        function fmtMoney(n) {
          n = Math.floor(n);
          if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B $";
          if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M $";
          if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K $";
          return n + " $";
        }

        function showToast(msg) {
          toastEl.textContent = msg;
          toastEl.classList.add("show");
          clearTimeout(showToast._t);
          showToast._t = setTimeout(
            () => toastEl.classList.remove("show"),
            1400,
          );
        }

        const LOGICAL_W = 600;
        const LOGICAL_H = 600;
        const W = LOGICAL_W,
          H = LOGICAL_H;
        let DPR = 1;

        function resize() {
          DPR = window.devicePixelRatio || 1;
          const cw = boardWrap.clientWidth;
          const ch = boardWrap.clientHeight;
          const scale = Math.max(
            0.001,
            Math.min(cw / LOGICAL_W, ch / LOGICAL_H),
          );
          const dispW = LOGICAL_W * scale;
          const dispH = LOGICAL_H * scale;

          canvas.style.width = dispW + "px";
          canvas.style.height = dispH + "px";
          canvas.width = LOGICAL_W * DPR;
          canvas.height = LOGICAL_H * DPR;
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        window.addEventListener("resize", resize);
        resize();

        function paddleRect(p) {
          if (p.side === "left" || p.side === "right") {
            const edgeLen = H;
            const half = PADDLE_LEN / 2;
            let center = clamp(p.pos * edgeLen, half, edgeLen - half);
            p.pos = center / edgeLen;
            const x = p.side === "left" ? 0 : W - PADDLE_THICK;
            return {
              x,
              y: center - half,
              w: PADDLE_THICK,
              h: PADDLE_LEN,
              orient: "v",
              center,
            };
          } else {
            const edgeLen = W;
            const half = PADDLE_LEN / 2;
            let center = clamp(p.pos * edgeLen, half, edgeLen - half);
            p.pos = center / edgeLen;
            const y = p.side === "top" ? 0 : H - PADDLE_THICK;
            return {
              x: center - half,
              y,
              w: PADDLE_LEN,
              h: PADDLE_THICK,
              orient: "h",
              center,
            };
          }
        }
        function clamp(v, a, b) {
          return Math.max(a, Math.min(b, v));
        }

        function updatePaddlesAuto() {
          for (const p of paddles) {
            if (!p.auto) continue;
            const edgeLen = p.side === "left" || p.side === "right" ? H : W;
            const halfFrac = PADDLE_LEN / 2 / edgeLen;
            p.pos += p.dir * AUTO_SPEED;
            if (p.pos >= 1 - halfFrac) {
              p.pos = 1 - halfFrac;
              p.dir = -1;
            }
            if (p.pos <= halfFrac) {
              p.pos = halfFrac;
              p.dir = 1;
            }
          }
        }

        function spawnBall(x, y) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2.4 + Math.random() * 1.6;
          // TAMBAHAN: hanya sejumlah `maxBallStay` bola yang boleh stay
          // permanen di papan. Bola berikutnya di luar kuota itu ditandai
          // sementara (stayable=false) dan akan hilang otomatis setelah
          // MAX_TEMP_BALL_BOUNCES kali memantul.
          const stayableCount = balls.reduce(
            (n, b) => n + (b.stayable ? 1 : 0),
            0,
          );
          const stayable = stayableCount < maxBallStay;
          balls.push({
            x: clamp(x, BALL_R + 4, W - BALL_R - 4),
            y: clamp(y, BALL_R + 4, H - BALL_R - 4),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            baseValue: 1,
            stayable,
            bounces: 0,
          });
        }

        // TAMBAHAN: Fungsi untuk me-spawn partikel saat bola menabrak paddle
        function spawnParticles(x, y) {
          for (let i = 0; i < 8; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 2 + 1.5;
            particles.push({
              x: x,
              y: y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: 1,
              size: Math.random() * 2 + 1,
              color: Math.random() > 0.5 ? "#f2b60c" : "#ffffff",
            });
          }
        }

        function paddleCoversPoint(p, coord) {
          const r = paddleRect(p);
          if (r.orient === "v") return coord >= r.y && coord <= r.y + r.h;
          else return coord >= r.x && coord <= r.x + r.w;
        }

        function findPaddleOnSide(side, coord) {
          for (const p of paddles) {
            if (p.side === side && paddleCoversPoint(p, coord)) return p;
          }
          return null;
        }

        function addFloater(x, y, text, color) {
          floaters.push({ x, y, text, color, life: 1 });
        }

        function earn(ball, paddle) {
          const gain = ball.baseValue * ballMultiplier * paddle.value;
          money += gain;
          totalEarned += gain;
          addFloater(
            ball.x,
            ball.y,
            "+" + fmtMoney(gain).replace(" $", ""),
            "#f2b60c",
          );

          // TAMBAHAN: Panggil visual efek dan beri tanda flash putih pada paddle
          paddle.hitFlash = 1.0;
          spawnParticles(ball.x, ball.y);

          // AUDIO: SFX bola memantul + SFX dapat uang
          AudioManager.playBounce();
          AudioManager.playCoin();
        }

        // TAMBAHAN: bola sementara (stayable=false) kehilangan "umur"
        // (jatah pantulan) setiap kali memantul di sisi papan manapun,
        // bukan cuma saat kena paddle -- jadi memantul di dinding kosong
        // pun ikut mempercepat waktunya untuk kembali ke slot bola.
        function registerBounceLife(ball) {
          if (!ball.stayable) {
            ball.bounces = (ball.bounces || 0) + 1;
          }
        }

        // TAMBAHAN: efek partikel "pecah memantul" saat bola sementara
        // kembali ke slot bola -- burst partikel lebih ramai & menyebar
        // dibanding partikel biasa saat kena paddle.
        function spawnVanishBurst(x, y) {
          for (let i = 0; i < 16; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3.2 + 2;
            particles.push({
              x,
              y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: 1,
              size: Math.random() * 2.5 + 1.5,
              color: Math.random() > 0.5 ? "#5ee6c9" : "#ffffff",
            });
          }
        }

        function updateBalls() {
          // TAMBAHAN: iterasi mundur pakai index supaya bola sementara
          // (stayable=false) yang sudah mencapai batas pantulan bisa
          // langsung dihapus (splice) dengan aman dalam loop yang sama.
          for (let i = balls.length - 1; i >= 0; i--) {
            const b = balls[i];
            b.x += b.vx;
            b.y += b.vy;

            if (b.x - BALL_R <= 0) {
              b.x = BALL_R;
              const p = findPaddleOnSide("left", b.y);
              if (p) earn(b, p);
              registerBounceLife(b);
              b.vx = Math.abs(b.vx);
            } else if (b.x + BALL_R >= W) {
              b.x = W - BALL_R;
              const p = findPaddleOnSide("right", b.y);
              if (p) earn(b, p);
              registerBounceLife(b);
              b.vx = -Math.abs(b.vx);
            }
            if (b.y - BALL_R <= 0) {
              b.y = BALL_R;
              const p = findPaddleOnSide("top", b.x);
              if (p) earn(b, p);
              registerBounceLife(b);
              b.vy = Math.abs(b.vy);
            } else if (b.y + BALL_R >= H) {
              b.y = H - BALL_R;
              const p = findPaddleOnSide("bottom", b.x);
              if (p) earn(b, p);
              registerBounceLife(b);
              b.vy = -Math.abs(b.vy);
            }

            // TAMBAHAN: bola sementara yang sudah melewati batas pantulan
            // tidak benar-benar hilang -- ia "pecah" jadi partikel dan
            // kembali sebagai stok bola siap pakai (availableBalls++),
            // jadi pemain tinggal tap papan lagi untuk spawn ulang.
            if (!b.stayable && b.bounces >= MAX_TEMP_BALL_BOUNCES) {
              spawnVanishBurst(b.x, b.y);
              availableBalls++;
              balls.splice(i, 1);
              updateUI();
            }
          }
        }

        function draw() {
          ctx.clearRect(0, 0, W, H);

          for (const p of paddles) {
            const r = paddleRect(p);
            const isDrag = p === dragPaddle;

            // TAMBAHAN: Logika pewarnaan Paddle berubah menjadi putih sementara saat ditabrak
            let baseColor = isDrag ? "#ffd54a" : "#f2b60c";
            if (p.hitFlash > 0) {
              ctx.fillStyle = "#ffffff";
              p.hitFlash -= 0.1; // Redupkan kilat secara perlahan
            } else {
              ctx.fillStyle = baseColor;
            }

            roundRect(r.x, r.y, r.w, r.h, 6);
            ctx.fill();

            if (p.auto) {
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#5ee6c9";
              roundRect(r.x, r.y, r.w, r.h, 6);
              ctx.stroke();
            }
            ctx.fillStyle = "#1a1305";
            ctx.font = "700 13px Segoe UI, Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(p.value, r.x + r.w / 2, r.y + r.h / 2);
          }

          for (const b of balls) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
            // TAMBAHAN: bola sementara (bukan kuota "stay") digambar
            // sedikit transparan agar pemain sadar bola ini akan hilang.
            if (!b.stayable) {
              const remaining = Math.max(
                0,
                MAX_TEMP_BALL_BOUNCES - (b.bounces || 0),
              );
              ctx.globalAlpha = 0.45 + 0.11 * remaining;
              ctx.fillStyle = "#ffdca0";
              ctx.shadowColor = "rgba(255,92,92,0.6)";
            } else {
              ctx.fillStyle = "#fff";
              ctx.shadowColor = "rgba(242,182,12,0.6)";
            }
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
          }

          // TAMBAHAN: Render Partikel Efek Visual
          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.04;
            if (p.life <= 0) {
              particles.splice(i, 1);
            } else {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }

          for (let i = floaters.length - 1; i >= 0; i--) {
            const f = floaters[i];
            ctx.globalAlpha = f.life;
            ctx.fillStyle = f.color;
            ctx.font = "700 12px Segoe UI, Arial";
            ctx.textAlign = "center";
            ctx.fillText(f.text, f.x, f.y - 14 * (1 - f.life));
            ctx.globalAlpha = 1;
            f.life -= 0.02;
            if (f.life <= 0) floaters.splice(i, 1);
          }
        }
        function roundRect(x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        }

        let dragPaddle = null;
        let downPos = null;
        let moved = false;

        function getPos(e) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = LOGICAL_W / rect.width;
          const scaleY = LOGICAL_H / rect.height;
          const cx =
            ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) *
            scaleX;
          const cy =
            ((e.touches ? e.touches[0].clientY : e.clientY) - rect.top) *
            scaleY;
          return { x: cx, y: cy };
        }

        function hitPaddle(pos) {
          for (const p of paddles) {
            const r = paddleRect(p);
            if (
              pos.x >= r.x - 4 &&
              pos.x <= r.x + r.w + 4 &&
              pos.y >= r.y - 4 &&
              pos.y <= r.y + r.h + 4
            )
              return p;
          }
          return null;
        }

        function pointerDown(e) {
          const pos = getPos(e);
          downPos = pos;
          moved = false;
          const p = hitPaddle(pos);
          if (p) dragPaddle = p;
        }
        function pointerMove(e) {
          if (!downPos) return;
          const pos = getPos(e);
          if (Math.abs(pos.x - downPos.x) + Math.abs(pos.y - downPos.y) > 4)
            moved = true;

          if (dragPaddle) {
            if (moved) dragPaddle.auto = false;
            const dLeft = pos.x,
              dRight = W - pos.x,
              dTop = pos.y,
              dBottom = H - pos.y;
            const m = Math.min(dLeft, dRight, dTop, dBottom);
            let side;
            if (m === dLeft) side = "left";
            else if (m === dRight) side = "right";
            else if (m === dTop) side = "top";
            else side = "bottom";
            dragPaddle.side = side;
            if (side === "left" || side === "right")
              dragPaddle.pos = clamp(pos.y / H, 0, 1);
            else dragPaddle.pos = clamp(pos.x / W, 0, 1);
          }
        }
        function pointerUp(e) {
          if (dragPaddle) {
            if (!moved) {
              dragPaddle.auto = !dragPaddle.auto;
              if (dragPaddle.auto)
                dragPaddle.dir = Math.random() < 0.5 ? 1 : -1;
              showToast(
                dragPaddle.auto ? "Paddle: AUTO-MOVE ON" : "Paddle: MANUAL",
              );
            }
            dragPaddle = null;
            downPos = null;
            return;
          }
          if (downPos && !moved) {
            if (availableBalls > 0) {
              spawnBall(downPos.x, downPos.y);
              availableBalls--;
              updateUI();
              hint.style.display = "none";
            } else {
              showToast("No balls available");
            }
          }
          downPos = null;
        }

        canvas.addEventListener("mousedown", pointerDown);
        window.addEventListener("mousemove", pointerMove);
        window.addEventListener("mouseup", pointerUp);
        canvas.addEventListener(
          "touchstart",
          (e) => {
            pointerDown(e);
            e.preventDefault();
          },
          { passive: false },
        );
        canvas.addEventListener(
          "touchmove",
          (e) => {
            pointerMove(e);
            e.preventDefault();
          },
          { passive: false },
        );
        canvas.addEventListener(
          "touchend",
          (e) => {
            pointerUp(e);
            e.preventDefault();
          },
          { passive: false },
        );

        const btnAddBall = document.getElementById("btnAddBall");
        const btnBallProfit = document.getElementById("btnBallProfit");
        const btnAddPaddle = document.getElementById("btnAddPaddle");
        const btnMerge = document.getElementById("btnMerge");
        const btnMaxBallStay = document.getElementById("btnMaxBallStay");

        function trySpend(cost) {
          if (money >= cost) {
            money -= cost;
            return true;
          }
          return false;
        }
        function flash(btn) {
          btn.classList.add("flash");
          setTimeout(() => btn.classList.remove("flash"), 300);
        }

        btnAddBall.addEventListener("click", () => {
          const cost = costAddBall();
          if (trySpend(cost)) {
            availableBalls++;
            ballsBought++;
            AudioManager.playUpgrade();
            updateUI();
          } else flash(btnAddBall);
        });

        btnBallProfit.addEventListener("click", () => {
          const cost = costProfit();
          if (trySpend(cost)) {
            ballMultiplier *= 2;
            profitBought++;
            AudioManager.playUpgrade();
            updateUI();
          } else flash(btnBallProfit);
        });

        const MAX_SIDE_COVERAGE = 0.75;

        function sideCoverage(side) {
          const edgeLen = side === "left" || side === "right" ? H : W;
          const total =
            paddles.filter((p) => p.side === side).length * PADDLE_LEN;
          return total / edgeLen;
        }

        btnAddPaddle.addEventListener("click", () => {
          const cost = costAddPaddle();
          const sides = ["top", "bottom", "left", "right"];
          const coverage = sides.map(sideCoverage);
          const minCoverage = Math.min(...coverage);
          if (minCoverage >= MAX_SIDE_COVERAGE) {
            showToast("All paddle sides are full.");
            flash(btnAddPaddle);
            return;
          }
          if (trySpend(cost)) {
            const candidates = sides.filter(
              (s, i) => coverage[i] === minCoverage,
            );
            const side =
              candidates[Math.floor(Math.random() * candidates.length)];
            paddles.push({
              side,
              pos: Math.random() * 0.8 + 0.1,
              value: 1,
              auto: true,
              dir: Math.random() < 0.5 ? 1 : -1,
              hitFlash: 0, // TAMBAHAN: inisialisasi hitFlash untuk paddle baru
            });
            paddlesBought++;
            AudioManager.playUpgrade();
            updateUI();
          } else flash(btnAddPaddle);
        });

        btnMerge.addEventListener("click", () => {
          let found = null;
          outer: for (let i = 0; i < paddles.length; i++) {
            for (let j = i + 1; j < paddles.length; j++) {
              if (
                paddles[i].side === paddles[j].side &&
                paddles[i].value === paddles[j].value
              ) {
                found = [i, j];
                break outer;
              }
            }
          }
          if (!found) {
            showToast("No matching paddles to merge.");
            flash(btnMerge);
            return;
          }
          const cost = costMerge();
          if (trySpend(cost)) {
            const [i, j] = found;
            // PERBAIKAN: sebelumnya nilai dijumlahkan (1+1=2, 2+2=4, ...)
            // sehingga naik kelipatan dua. Sekarang naik urut +1 saja
            // (1+1=2, 2+2=3, 3+3=4, dst) sesuai permintaan.
            paddles[i].value += 1;
            paddles[i].pos = (paddles[i].pos + paddles[j].pos) / 2;
            paddles.splice(j, 1);
            mergesBought++;
            AudioManager.playUpgrade();
            updateUI();
          } else flash(btnMerge);
        });

        btnMaxBallStay.addEventListener("click", () => {
          const cost = costMaxBallStay();
          if (trySpend(cost)) {
            maxBallStay++;
            maxBallStayBought++;
            AudioManager.playUpgrade();
            updateUI();
            showToast("Max Ball Stay now: " + maxBallStay);
          } else flash(btnMaxBallStay);
        });

        function updateUI() {
          document.getElementById("ballCount").textContent = availableBalls;
          document.getElementById("money").textContent = fmtMoney(money);
          document.getElementById("priceAddBall").textContent =
            fmtMoney(costAddBall());
          document.getElementById("priceBallProfit").textContent =
            fmtMoney(costProfit());
          document.getElementById("priceAddPaddle").textContent =
            fmtMoney(costAddPaddle());
          document.getElementById("priceMerge").textContent =
            fmtMoney(costMerge());
          document.getElementById("priceMaxBallStay").textContent =
            fmtMoney(costMaxBallStay());
          document.getElementById("maxBallStayDesc").textContent =
            "Currently: " + maxBallStay + " balls can stay";

          setAfford(btnAddBall, money >= costAddBall());
          setAfford(btnBallProfit, money >= costProfit());
          setAfford(btnAddPaddle, money >= costAddPaddle());
          setAfford(btnMerge, money >= costMerge());
          setAfford(btnMaxBallStay, money >= costMaxBallStay());

          const totalPurchases =
            ballsBought +
            profitBought +
            paddlesBought +
            mergesBought +
            maxBallStayBought;
          const level = Math.floor(totalPurchases / 5) + 1;
          const progress = ((totalPurchases % 5) / 5) * 100;
          document.getElementById("lvText").textContent = "Level " + level;
          document.getElementById("lvFill").style.width = progress + "%";
        }
        function setAfford(btn, ok) {
          btn.classList.toggle("affordable", ok);
        }

        const updateLog = [
          {
            version: "v1.0.1",
            date: "04/08/2026",
            changes: [
              {
                type: "added",
                text: "PWA Support",
              },
              {
                type: "added",
                text: "Music & Sfx",
              },
              {
                type: "added",
                text: "Max ball stay upgrade",
              },
              {
                type: "fixed",
                text: "Language consistency and shorten description text",
              },
              {
                type: "fixed",
                text: "Balancing gameplay and upgrade cost",
              },
              {
                type: "issue",
                text: "Login at same time on multiple devices may cause sync issues",
              },
            ],
          },
          {
            version: "v1.0.0",
            date: "03/08/2026",
            changes: [
              {
                type: "added",
                text: "Release",
              },
              {
                type: "added",
                text: "Leaderboard",
              },
              {
                type: "added",
                text: "Cloud Save",
              },
              {
                type: "fixed",
                text: "Device compatibility issues",
              },
              {
                type: "issue",
                text: "Login at same time on multiple devices may cause sync issues",
              },
            ],
          },
        ];

        function renderUpdateLog() {
          const container = document.getElementById("logListContainer");
          container.innerHTML = updateLog
            .map(
              (entry) => `
            <div class="log-entry">
              <div class="log-version">${entry.version} <span class="log-date">${entry.date}</span></div>
              <ul class="log-list">
                ${entry.changes.map((c) => `<li><span class="log-tag ${c.type}">${c.type}</span>${escapeHtml(c.text)}</li>`).join("")}
              </ul>
            </div>`,
            )
            .join("");
        }

        const creditData = {
          name: "Scarrotles",
          role: "Game Developer",
          socials: [
            { label: "YouTube", url: "https://youtube.com/@scarrotles" },
            {
              label: "Instagram",
              url: "https://instagram.com/scarrotles.work",
            },
            // TAMBAHAN: link Tako untuk player yang ingin support developer.
            { label: "Support via Tako", url: "https://tako.id/Scarrotles" },
          ],
        };

        function renderCredit() {
          document.getElementById("creditName").textContent = creditData.name;
          document.getElementById("creditRole").textContent = creditData.role;
          document.getElementById("socialList").innerHTML = creditData.socials
            .map(
              (s) => `
            <a class="social-item" href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">
              <span class="dot"></span>${escapeHtml(s.label)}
            </a>`,
            )
            .join("");
        }

        function escapeHtml(str) {
          return String(str).replace(
            /[&<>"']/g,
            (ch) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[ch],
          );
        }
        function escapeAttr(str) {
          return escapeHtml(str);
        }

        const modalOverlay = document.getElementById("modalOverlay");
        const helpBtn = document.getElementById("helpBtn");
        const modalClose = document.getElementById("modalClose");

        function openModal() {
          modalOverlay.classList.add("open");
        }
        function closeModal() {
          modalOverlay.classList.remove("open");
        }
        helpBtn.addEventListener("click", openModal);
        modalClose.addEventListener("click", closeModal);
        modalOverlay.addEventListener("click", (e) => {
          if (e.target === modalOverlay) closeModal();
        });
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape") closeModal();
        });

        document.querySelectorAll(".tab-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            document
              .querySelectorAll(".tab-btn")
              .forEach((b) => b.classList.remove("active"));
            document
              .querySelectorAll(".tab-panel")
              .forEach((p) => p.classList.remove("active"));
            btn.classList.add("active");
            document
              .getElementById("panel-" + btn.dataset.tab)
              .classList.add("active");
            if (btn.dataset.tab === "cloud") {
              document.getElementById("cloudUsernameInput").value =
                cloudUsername;
              updateCloudPanel();
            }
          });
        });

        renderUpdateLog();
        renderCredit();

        // =====================================================
        // SISTEM SAVE: Local (localStorage) + Cloud (Supabase)
        // =====================================================
        const LOCAL_SAVE_KEY = "paddleBounceIdle_save_v1";
        const SUPABASE_URL = window.SUPABASE_URL || "";
        const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";
        let sb = null;
        if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
          sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        let cloudUser = null;
        let cloudUsername = localStorage.getItem("pb_username") || "";
        let lastCloudSyncAt = 0;

        function serializeState() {
          return {
            v: 1,
            money,
            availableBalls,
            ballMultiplier,
            ballsBought,
            profitBought,
            paddlesBought,
            mergesBought,
            maxBallStay,
            maxBallStayBought,
            totalEarned,
            paddles: paddles.map((p) => ({
              side: p.side,
              pos: p.pos,
              value: p.value,
              auto: p.auto,
              dir: p.dir,
            })),
            // Bola yang sedang aktif memantul di papan, agar tidak hilang
            // saat browser di-refresh / game dibuka lagi.
            balls: balls.map((b) => ({
              x: b.x,
              y: b.y,
              vx: b.vx,
              vy: b.vy,
              baseValue: b.baseValue,
              stayable: b.stayable,
              bounces: b.bounces,
            })),
          };
        }

        function applyState(s) {
          if (!s) return;
          money = s.money ?? 0;
          availableBalls = s.availableBalls ?? 5;
          ballMultiplier = s.ballMultiplier ?? 1;
          ballsBought = s.ballsBought ?? 0;
          profitBought = s.profitBought ?? 0;
          paddlesBought = s.paddlesBought ?? 0;
          mergesBought = s.mergesBought ?? 0;
          maxBallStay = s.maxBallStay ?? 1;
          maxBallStayBought = s.maxBallStayBought ?? 0;
          totalEarned = s.totalEarned ?? money;
          if (Array.isArray(s.paddles) && s.paddles.length) {
            paddles = s.paddles.map((p) => ({
              side: p.side,
              pos: p.pos,
              value: p.value,
              auto: p.auto,
              dir: p.dir ?? (Math.random() < 0.5 ? 1 : -1),
              hitFlash: 0,
            }));
          }
          if (Array.isArray(s.balls) && s.balls.length) {
            balls = s.balls
              .filter(
                (b) =>
                  Number.isFinite(b.x) &&
                  Number.isFinite(b.y) &&
                  Number.isFinite(b.vx) &&
                  Number.isFinite(b.vy),
              )
              .map((b) => ({
                x: clamp(b.x, BALL_R + 4, W - BALL_R - 4),
                y: clamp(b.y, BALL_R + 4, H - BALL_R - 4),
                vx: b.vx,
                vy: b.vy,
                baseValue: b.baseValue ?? 1,
                // Save lama belum punya field ini -> anggap stayable=true
                // (permanen) supaya bola yang sudah ada tidak tiba-tiba
                // hilang gara-gara update ini.
                stayable: b.stayable ?? true,
                bounces: b.bounces ?? 0,
              }));
          } else {
            balls = [];
          }
          if (balls.length) hint.style.display = "none";
          updateUI();
        }

        function saveLocal() {
          try {
            localStorage.setItem(
              LOCAL_SAVE_KEY,
              JSON.stringify(serializeState()),
            );
          } catch (e) {
            /* storage unavailable / full, ignore */
          }
        }

        function loadLocal() {
          try {
            const raw = localStorage.getItem(LOCAL_SAVE_KEY);
            if (raw) applyState(JSON.parse(raw));
          } catch (e) {
            /* corrupted save, ignore */
          }
        }

        async function fetchProfileUsername(user) {
          if (!user) return;
          const { data, error } = await sb
            .from("profiles")
            .select("username")
            .eq("id", user.id)
            .maybeSingle();
          if (!error && data && data.username) {
            cloudUsername = data.username;
            localStorage.setItem("pb_username", cloudUsername);
          }
          const inputEl = document.getElementById("cloudUsernameInput");
          if (inputEl) inputEl.value = cloudUsername;
        }

        function mapAuthError(error) {
          const code = error.code || error.error_code || "";
          const msg = (error.message || "").toLowerCase();
          if (code === "email_address_invalid" || msg.includes("invalid")) {
            return "Alamat email tidak valid. Gunakan email asli (Gmail/Outlook/dll), bukan domain contoh seperti example.com/test.com.";
          }
          if (
            code === "over_email_send_rate_limit" ||
            msg.includes("rate limit")
          ) {
            return "Terlalu banyak percobaan kirim email konfirmasi (limit bawaan Supabase sangat kecil). Nonaktifkan 'Confirm email' di dashboard Supabase (Authentication > Providers > Email) agar bisa daftar tanpa verifikasi email, lalu coba lagi.";
          }
          if (
            code === "user_already_exists" ||
            msg.includes("already registered")
          ) {
            return "Email ini sudah terdaftar. Coba tombol Masuk.";
          }
          if (
            code === "email_not_confirmed" ||
            msg.includes("email not confirmed")
          ) {
            return "Email belum dikonfirmasi. Cek inbox/spam, atau matikan 'Confirm email' di dashboard Supabase supaya tidak perlu verifikasi.";
          }
          if (code === "invalid_credentials" || msg.includes("invalid login")) {
            return "Email atau password salah.";
          }
          return error.message || "Terjadi kesalahan tidak diketahui.";
        }

        // Kondisi awal (starter) untuk pemain baru: 5 bola siap pakai,
        // uang 0, dan 4 paddle dasar di tiap sisi papan.
        function resetToStarterState() {
          money = 0;
          availableBalls = 5;
          ballMultiplier = 1;
          ballsBought = 0;
          profitBought = 0;
          paddlesBought = 0;
          mergesBought = 0;
          maxBallStay = 1;
          maxBallStayBought = 0;
          totalEarned = 0;
          paddles = [
            {
              side: "top",
              pos: 0.5,
              value: 1,
              auto: true,
              dir: 1,
              hitFlash: 0,
            },
            {
              side: "bottom",
              pos: 0.5,
              value: 1,
              auto: true,
              dir: -1,
              hitFlash: 0,
            },
            {
              side: "left",
              pos: 0.5,
              value: 1,
              auto: true,
              dir: 1,
              hitFlash: 0,
            },
            {
              side: "right",
              pos: 0.5,
              value: 1,
              auto: true,
              dir: -1,
              hitFlash: 0,
            },
          ];
          balls = [];
          floaters = [];
          particles = [];
          hint.style.display = "";
          updateUI();
        }

        async function registerAccount(email, password) {
          if (!sb) {
            showToast("Cloud save belum dikonfigurasi.");
            return;
          }
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) {
            showToast("Gagal mendaftar: " + mapAuthError(error));
            return;
          }
          if (data.session && data.user) {
            cloudUser = data.user;
            await fetchProfileUsername(cloudUser);
            // Akun baru selalu dimulai dari kondisi starter (5 bola),
            // terlepas dari progres lokal perangkat sebelumnya (mis. main
            // sebagai tamu lalu baru daftar).
            resetToStarterState();
            saveLocal();
            showToast(
              "Akun berhasil dibuat & masuk! Kamu mulai dengan 5 bola starter.",
            );
            updateCloudPanel();
          } else if (data.user && !data.session) {
            showToast(
              "Akun dibuat, tapi butuh konfirmasi email untuk masuk. Cek inbox, atau matikan 'Confirm email' di dashboard Supabase agar bisa langsung masuk.",
            );
          } else {
            showToast(
              "Akun dibuat. Cek email untuk konfirmasi, lalu tekan Masuk.",
            );
          }
        }

        async function loginAccount(email, password) {
          if (!sb) {
            showToast("Cloud save belum dikonfigurasi.");
            return;
          }
          const { data, error } = await sb.auth.signInWithPassword({
            email,
            password,
          });
          if (error) {
            showToast("Gagal masuk: " + mapAuthError(error));
            return;
          }
          cloudUser = data.user;
          await fetchProfileUsername(cloudUser);
          // Selalu tarik progres terbaru dari cloud saat login, supaya
          // device ini tidak melanjutkan dari state lokal yang usang
          // (inilah sumber utama bug "bola hilang / uang tidak sinkron"
          // saat 1 akun dipakai di 2 device berbeda).
          const loaded = await cloudLoad({ silent: true });
          showToast(
            loaded
              ? "Berhasil masuk! Progres terbaru dari cloud dimuat."
              : "Berhasil masuk!",
          );
          updateCloudPanel();
        }

        async function logoutAccount() {
          if (!sb) return;
          await sb.auth.signOut();
          cloudUser = null;
          cloudUsername = "";
          localStorage.removeItem("pb_username");
          // PERBAIKAN: setelah keluar akun, papan (paddle, upgrade, bola)
          // di-reset ke kondisi starter, supaya sesi berikutnya (mis. main
          // sebagai tamu atau login akun lain) tidak melanjutkan progres
          // akun sebelumnya.
          lastKnownCloudUpdatedAt = null;
          resetToStarterState();
          saveLocal();
          showToast("Berhasil keluar dari akun. Papan direset ke awal.");
          updateCloudPanel();
        }

        async function setCloudUsername(name) {
          if (!cloudUser) return false;
          const { error } = await sb
            .from("profiles")
            .upsert({ id: cloudUser.id, username: name });
          if (error) {
            showToast("Gagal menyimpan nama: " + error.message);
            return false;
          }
          cloudUsername = name;
          localStorage.setItem("pb_username", name);
          return true;
        }

        // Timestamp (ISO string) dari versi save cloud terakhir yang
        // *diketahui* oleh device ini (baik karena baru dimuat, maupun
        // baru berhasil disimpan). Dipakai untuk mendeteksi jika ada
        // device lain yang menyimpan progres lebih baru sejak itu, supaya
        // kita tidak menimpa progres tersebut secara diam-diam.
        let lastKnownCloudUpdatedAt = null;

        async function cloudSave({ silent = false } = {}) {
          if (!sb) {
            if (!silent) showToast("Cloud save belum dikonfigurasi.");
            return;
          }
          if (!cloudUser) {
            if (!silent)
              showToast("Silakan daftar/masuk akun dulu di tab Cloud Save.");
            return;
          }
          if (!cloudUsername) {
            if (!silent) showToast("Set nama pemain dulu di tab Cloud Save.");
            return;
          }

          // Cek dulu versi terbaru di cloud sebelum menimpa. Jika ada
          // perubahan dari device lain yang belum kita lihat, muat versi
          // itu dulu alih-alih menimpanya dengan data device ini yang lebih
          // usang (mencegah bola/uang "hilang" karena tertimpa).
          const { data: existing, error: checkError } = await sb
            .from("saves")
            .select("data, updated_at")
            .eq("user_id", cloudUser.id)
            .maybeSingle();
          if (checkError) {
            if (!silent) showToast("Gagal memeriksa data cloud.");
            return;
          }
          const conflict =
            existing &&
            lastKnownCloudUpdatedAt &&
            new Date(existing.updated_at) > new Date(lastKnownCloudUpdatedAt);
          if (conflict) {
            applyState(existing.data);
            lastKnownCloudUpdatedAt = existing.updated_at;
            saveLocal();
            showToast(
              "Progres lebih baru ditemukan dari device lain, dimuat otomatis agar tidak ada yang hilang. Silakan lanjutkan main dan simpan lagi.",
            );
            updateCloudPanel();
            return;
          }

          const nowIso = new Date().toISOString();
          const level =
            Math.floor(
              (ballsBought +
                profitBought +
                paddlesBought +
                mergesBought +
                maxBallStayBought) /
                5,
            ) + 1;
          const { data: existingLb } = await sb
            .from("leaderboard")
            .select("score")
            .eq("user_id", cloudUser.id)
            .maybeSingle();
          const finalScore = Math.max(
            Math.floor(totalEarned),
            existingLb && existingLb.score ? existingLb.score : 0,
          );
          const { error: e1 } = await sb.from("saves").upsert({
            user_id: cloudUser.id,
            data: serializeState(),
            updated_at: nowIso,
          });
          const { error: e2 } = await sb.from("leaderboard").upsert({
            user_id: cloudUser.id,
            username: cloudUsername,
            score: finalScore,
            level,
            updated_at: nowIso,
          });
          if (e1 || e2) {
            if (!silent) showToast("Gagal menyimpan ke cloud.");
            return;
          }
          lastKnownCloudUpdatedAt = nowIso;
          lastCloudSyncAt = Date.now();
          if (!silent) showToast("Progres tersimpan ke cloud!");
          updateCloudPanel();
        }

        async function cloudLoad({ silent = false } = {}) {
          if (!sb) {
            if (!silent) showToast("Cloud save is not configured yet.");
            return false;
          }
          if (!cloudUser) {
            if (!silent)
              showToast("Silakan daftar/masuk akun dulu di tab Cloud Save.");
            return false;
          }
          const { data, error } = await sb
            .from("saves")
            .select("data, updated_at")
            .eq("user_id", cloudUser.id)
            .maybeSingle();
          if (error) {
            if (!silent) showToast("Gagal memuat save dari cloud.");
            return false;
          }
          if (!data) {
            if (!silent) showToast("Belum ada save di cloud untuk akun ini.");
            return false;
          }
          applyState(data.data);
          lastKnownCloudUpdatedAt = data.updated_at;
          saveLocal();
          if (!silent) showToast("Save dari cloud berhasil dimuat!");
          return true;
        }

        function leaderboardSkeletonHTML(rows = 6) {
          const widths = [85, 60, 95, 45, 75, 55, 90, 65];
          let out = "";
          for (let i = 0; i < rows; i++) {
            out += `
            <div class="lb-skeleton-row">
              <div class="lb-skeleton lb-skeleton-rank"></div>
              <div class="lb-skeleton lb-skeleton-name" style="width:${widths[i % widths.length]}%"></div>
              <div class="lb-skeleton lb-skeleton-score"></div>
            </div>`;
          }
          return out;
        }

        async function fetchLeaderboard() {
          const listEl = document.getElementById("leaderboardList");
          if (!sb) {
            listEl.innerHTML =
              '<div class="lb-empty">Leaderboard is not configured yet. See README.md for Supabase setup.</div>';
            return;
          }
          listEl.innerHTML = leaderboardSkeletonHTML();
          const { data, error } = await sb
            .from("leaderboard")
            .select("username, score, level")
            .order("score", { ascending: false })
            .limit(20);
          if (error) {
            listEl.innerHTML =
              '<div class="lb-empty">Gagal memuat leaderboard.</div>';
            return;
          }
          if (!data || !data.length) {
            listEl.innerHTML =
              '<div class="lb-empty">No data available. Be the first!</div>';
            return;
          }
          listEl.innerHTML = data
            .map(
              (row, i) => `
            <div class="lb-row ${row.username === cloudUsername ? "me" : ""}">
              <div class="lb-rank">#${i + 1}</div>
              <div class="lb-name">${escapeHtml(row.username)}</div>
              <div class="lb-score">${fmtMoney(row.score)} · Lv${row.level}</div>
            </div>`,
            )
            .join("");
        }

        function updateCloudPanel() {
          const statusEl = document.getElementById("cloudStatus");
          const authSection = document.getElementById("authSection");
          const accountSection = document.getElementById("accountSection");
          if (!sb) {
            statusEl.textContent =
              "Cloud save is not configured yet (Supabase not configured). Progress is still saved automatically on this device.";
            authSection.style.display = "none";
            accountSection.style.display = "none";
            return;
          }
          if (cloudUser) {
            authSection.style.display = "none";
            accountSection.style.display = "block";
            statusEl.textContent =
              "Logged in as " +
              cloudUser.email +
              (cloudUsername
                ? ' · name "' + cloudUsername + '"'
                : " · name not set") +
              (lastCloudSyncAt
                ? " · last sync " +
                  new Date(lastCloudSyncAt).toLocaleTimeString()
                : " · never synced");
          } else {
            authSection.style.display = "block";
            accountSection.style.display = "none";
            statusEl.textContent =
              "Sign Up or log in with the same email & password on all devices to keep your progress synced.";
          }
        }

        document
          .getElementById("btnSetUsername")
          .addEventListener("click", async () => {
            const val = document
              .getElementById("cloudUsernameInput")
              .value.trim();
            if (val.length < 3 || val.length > 20) {
              showToast("Nama harus 3-20 karakter.");
              return;
            }
            if (!sb) {
              showToast("Cloud save is not configured yet.");
              return;
            }
            if (!cloudUser) {
              showToast("Silakan daftar/masuk akun dulu.");
              return;
            }
            const ok = await setCloudUsername(val);
            if (ok) {
              showToast("Nama pemain disimpan: " + val);
              updateCloudPanel();
            }
          });
        document
          .getElementById("btnCloudSave")
          .addEventListener("click", cloudSave);
        document
          .getElementById("btnCloudLoad")
          .addEventListener("click", cloudLoad);
        document
          .getElementById("btnRefreshLb")
          .addEventListener("click", fetchLeaderboard);
        document
          .getElementById("btnRegister")
          .addEventListener("click", async () => {
            const email = document
              .getElementById("authEmailInput")
              .value.trim();
            const password = document.getElementById("authPasswordInput").value;
            if (!email || !password) {
              showToast("Isi email dan password dulu.");
              return;
            }
            if (password.length < 6) {
              showToast("Password minimal 6 karakter.");
              return;
            }
            await registerAccount(email, password);
          });
        document
          .getElementById("btnLogin")
          .addEventListener("click", async () => {
            const email = document
              .getElementById("authEmailInput")
              .value.trim();
            const password = document.getElementById("authPasswordInput").value;
            if (!email || !password) {
              showToast("Isi email dan password dulu.");
              return;
            }
            await loginAccount(email, password);
          });
        document
          .getElementById("btnLogout")
          .addEventListener("click", logoutAccount);

        // TAMBAHAN: Reset Progress untuk player yang sedang login dan
        // ingin kembali ke kondisi awal (starter). Minta konfirmasi dulu
        // karena aksi ini permanen, lalu simpan hasil reset ke cloud
        // (kalau memungkinkan) supaya progres lama tidak "kembali" lagi
        // saat login ulang di device lain.
        document
          .getElementById("btnResetProgress")
          .addEventListener("click", async () => {
            if (!cloudUser) {
              showToast("Silakan masuk akun dulu di tab Cloud Save.");
              return;
            }
            const sure = window.confirm(
              "Yakin ingin reset progress ke kondisi awal? Aksi ini tidak bisa dibatalkan dan akan menghapus progres tersimpan (termasuk di cloud).",
            );
            if (!sure) return;
            resetToStarterState();
            saveLocal();
            if (sb && cloudUsername) {
              await cloudSave({ silent: true });
            }
            showToast("Progress berhasil direset ke kondisi awal.");
            updateCloudPanel();
          });

        // PERBAIKAN: progres localStorage HANYA dimuat kalau ada sistem
        // cloud save (sb terkonfigurasi). Kalau tidak, tetap pakai
        // localStorage seperti sebelumnya (satu-satunya cara menyimpan
        // progress). Kalau cloud save tersedia, keputusan load ditunda
        // sampai status login diketahui (lihat blok sb.auth.getSession()
        // di bawah) -> player yang BELUM login akan selalu mulai dari
        // kondisi starter tiap kali browser di-refresh, sementara player
        // yang SUDAH login akan menarik progres dari cloud (dengan
        // localStorage cuma sebagai fallback jika cloud gagal dimuat).
        if (!sb) {
          loadLocal();
        }

        // Autosave: lokal tiap ada perubahan (lewat updateUI), plus
        // sinkron ke cloud berkala jika sudah punya nama pemain.
        setInterval(() => {
          saveLocal();
          if (sb && cloudUser && cloudUsername) cloudSave({ silent: true });
        }, 60000);
        window.addEventListener("beforeunload", saveLocal);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") saveLocal();
        });

        // ====================================================
        // PENGINGAT SIMPAN PROGRESS (untuk player yang belum login)
        // Muncul pertama kali setelah 5 menit bermain, lalu diulang
        // tiap 5 menit berikutnya selama player masih belum login
        // dan belum menutup pengingat pada sesi ini.
        // ====================================================
        (function setupSaveReminder() {
          const REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
          const reminderEl = document.getElementById("saveReminder");
          const loginBtn = document.getElementById("saveReminderLoginBtn");
          const dismissBtn = document.getElementById("saveReminderDismissBtn");
          if (!reminderEl || !loginBtn || !dismissBtn) return;

          let dismissedThisSession = false;
          let reminderTimer = null;

          function showReminder() {
            if (cloudUser || dismissedThisSession) return;
            reminderEl.classList.add("show");
          }

          function hideReminder() {
            reminderEl.classList.remove("show");
          }

          function scheduleNext() {
            clearTimeout(reminderTimer);
            reminderTimer = setTimeout(() => {
              if (!cloudUser && !dismissedThisSession) {
                showReminder();
              }
              scheduleNext();
            }, REMINDER_INTERVAL_MS);
          }

          loginBtn.addEventListener("click", () => {
            hideReminder();
            openModal();
            const cloudTabBtn = document.querySelector(
              '.tab-btn[data-tab="cloud"]',
            );
            if (cloudTabBtn) cloudTabBtn.click();
          });

          dismissBtn.addEventListener("click", () => {
            hideReminder();
            dismissedThisSession = true;
          });

          scheduleNext();
        })();

        if (sb) {
          sb.auth.getSession().then(async ({ data: { session } }) => {
            if (session && session.user) {
              cloudUser = session.user;
              await fetchProfileUsername(cloudUser);
              // Sesi login tersimpan dari sebelumnya (mis. device ini
              // sudah pernah login akun ini) -> tarik progres terbaru dari
              // cloud dulu sebelum melanjutkan, supaya selalu sinkron
              // dengan device lain yang mungkin menyimpan progres baru.
              const loaded = await cloudLoad({ silent: true });
              // Fallback: kalau gagal ambil dari cloud (mis. offline),
              // pakai save lokal terakhir daripada mulai dari nol.
              if (!loaded) loadLocal();
            }
            // Kalau tidak ada sesi (player belum login / tamu), TIDAK
            // memuat localStorage sama sekali -> papan tetap di kondisi
            // starter (default variable di awal script), sesuai
            // permintaan: progress tamu reset tiap browser di-refresh.
            updateCloudPanel();
          });
        } else {
          updateCloudPanel();
        }

        // Leaderboard kini selalu terlihat di layar utama, jadi dimuat
        // langsung saat start dan disegarkan otomatis secara berkala.
        fetchLeaderboard();
        setInterval(fetchLeaderboard, 30000);

        // ====================================================
        // GAME LOOP dengan "catch-up" berbasis waktu nyata
        // ----------------------------------------------------
        // Sebelumnya loop hanya mengandalkan requestAnimationFrame,
        // yang di-throttle habis-habisan oleh browser saat tab tidak
        // aktif (kadang cuma jalan ~1x/detik atau berhenti total).
        // Karena updatePaddlesAuto()/updateBalls() bergerak dengan
        // langkah tetap per panggilan (bukan berdasar delta time),
        // efeknya bola seperti "berhenti" saat pindah tab.
        //
        // Solusi: hitung berapa langkah simulasi (STEP_MS) yang
        // seharusnya terjadi berdasarkan selisih waktu nyata sejak
        // frame terakhir, lalu jalankan sejumlah itu sekaligus.
        // Dengan begitu, walau rAF cuma sempat "dipanggil" sesekali
        // saat tab background, begitu tab aktif lagi (atau bahkan
        // saat masih di background pada browser yang masih memanggil
        // rAF secara jarang), state bola langsung "mengejar" seakan
        // terus berjalan sejak awal — bukan diam di tempat.
        // ====================================================
        const STEP_MS = 1000 / 60; // 1 langkah simulasi = 1 frame @60fps
        const MAX_CATCHUP_MS = 5 * 60 * 1000; // cap 5 menit biar tidak macet kalau tab lama sekali di-background
        let lastFrameTime = performance.now();

        function loop() {
          const now = performance.now();
          let elapsed = now - lastFrameTime;
          lastFrameTime = now;

          if (elapsed > MAX_CATCHUP_MS) elapsed = MAX_CATCHUP_MS;

          let steps = Math.round(elapsed / STEP_MS);
          if (steps < 1) steps = 1; // minimal tetap jalan 1 langkah tiap frame

          for (let i = 0; i < steps; i++) {
            updatePaddlesAuto();
            updateBalls();
          }
          draw();
          if (Math.random() < 0.03) {
            updateUI();
            saveLocal();
          }
          requestAnimationFrame(loop);
        }

        updateUI();
        requestAnimationFrame(loop);
      })();

/* ==================================================
   TUTORIAL
   ================================================== */
      (function () {
        "use strict";
        // Tutorial hanya tampil sekali per device (localStorage).
        var TUT_KEY = "ib_tutorial_v1_done";
        if (localStorage.getItem(TUT_KEY) === "1") return;

        var root = document.getElementById("tutRoot");
        var maskTop = document.getElementById("tutMaskTop");
        var maskBottom = document.getElementById("tutMaskBottom");
        var maskLeft = document.getElementById("tutMaskLeft");
        var maskRight = document.getElementById("tutMaskRight");
        var ring = document.getElementById("tutRing");
        var hand = document.getElementById("tutHand");
        var tooltip = document.getElementById("tutTooltip");
        var stepBadge = document.getElementById("tutStepBadge");
        var titleEl = document.getElementById("tutTitle");
        var descEl = document.getElementById("tutDesc");
        var dotsEl = document.getElementById("tutDots");
        var nextBtn = document.getElementById("tutNextBtn");
        var skipBtn = document.getElementById("tutSkipBtn");
        var finishOverlay = document.getElementById("tutFinishOverlay");
        var finishBtn = document.getElementById("tutFinishBtn");

        // Referensi DOM sendiri (tutorial berjalan di IIFE terpisah dari
        // script utama game, jadi tidak memakai variabel/fungsi internal
        // game - cukup baca elemen & class-nya langsung dari DOM).
        var modalOverlayEl = document.getElementById("modalOverlay");

        var PAD = 10; // jarak highlight dari tepi elemen

        var steps = [
          {
            selector: "#board",
            title: "1. Spawn Bola Pertamamu",
            desc: "Ketuk / klik di area papan ini untuk memunculkan (spawn) bola. Bola akan memantul dan menghasilkan uang tiap kali mengenai paddle.",
            advanceOnClickTarget: true,
          },
          {
            selector: ".panel",
            title: "2. Menu Upgrade",
            desc: "Gunakan kartu-kartu di sini untuk membeli upgrade: tambah bola, naikkan profit, tambah paddle, hingga merge paddle jadi lebih kuat.",
          },
          {
            selector: ".leaderboard-panel",
            title: "3. Leaderboard",
            desc: "Papan peringkat pemain lainnya bisa dilihat di sini, dan otomatis diperbarui secara berkala.",
          },
          {
            selector: "#helpBtn",
            title: '4. Tombol "?"',
            desc: 'Tekan tombol "?" ini untuk membuka panel Info & Bantuan (About Game, How to Play, Cloud Save, dan lainnya).',
            advanceOnClickTarget: true,
            beforeShow: function () {
              // pastikan modal tertutup dulu sebelum step ini dimulai
              modalOverlayEl.classList.remove("open");
            },
          },
          {
            selector: '.tab-btn[data-tab="cloud"]',
            title: "5. Menu Cloud Save",
            desc: "Buka tab Cloud Save untuk daftar / masuk akun supaya progres permainanmu tersimpan aman dan bisa dilanjutkan di device lain.",
            advanceOnClickTarget: true,
            // tunggu modal Info & Bantuan benar-benar terbuka (dipicu klik
            // asli tombol "?" di step sebelumnya) sebelum highlight tab ini
            waitFor: function () {
              return modalOverlayEl.classList.contains("open");
            },
          },
        ];

        var current = -1;

        function elFor(step) {
          return document.querySelector(step.selector);
        }

        function positionMasksAndRing(rect) {
          var vw = window.innerWidth;
          var vh = window.innerHeight;
          var top = Math.max(rect.top - PAD, 0);
          var left = Math.max(rect.left - PAD, 0);
          var right = Math.min(rect.right + PAD, vw);
          var bottom = Math.min(rect.bottom + PAD, vh);

          maskTop.style.top = "0px";
          maskTop.style.left = "0px";
          maskTop.style.width = vw + "px";
          maskTop.style.height = top + "px";

          maskBottom.style.top = bottom + "px";
          maskBottom.style.left = "0px";
          maskBottom.style.width = vw + "px";
          maskBottom.style.height = Math.max(vh - bottom, 0) + "px";

          maskLeft.style.top = top + "px";
          maskLeft.style.left = "0px";
          maskLeft.style.width = left + "px";
          maskLeft.style.height = Math.max(bottom - top, 0) + "px";

          maskRight.style.top = top + "px";
          maskRight.style.left = right + "px";
          maskRight.style.width = Math.max(vw - right, 0) + "px";
          maskRight.style.height = Math.max(bottom - top, 0) + "px";

          ring.style.top = top + "px";
          ring.style.left = left + "px";
          ring.style.width = Math.max(right - left, 0) + "px";
          ring.style.height = Math.max(bottom - top, 0) + "px";

          hand.style.top = bottom - 30 + "px";
          hand.style.left = (left + right) / 2 - 13 + "px";

          positionTooltip(top, left, right, bottom, vw, vh);
        }

        function positionTooltip(top, left, right, bottom, vw, vh) {
          // ukur tooltip dulu (biar tau tinggi/lebarnya)
          tooltip.style.left = "-9999px";
          tooltip.style.top = "-9999px";
          tooltip.classList.remove("tut-hidden");
          var tw = tooltip.offsetWidth;
          var th = tooltip.offsetHeight;

          var spaceBelow = vh - bottom;
          var spaceAbove = top;
          var tTop, tLeft;

          if (spaceBelow >= th + 16 || spaceBelow >= spaceAbove) {
            tTop = Math.min(bottom + 14, vh - th - 10);
          } else {
            tTop = Math.max(top - th - 14, 10);
          }
          tLeft = (left + right) / 2 - tw / 2;
          if (tLeft < 10) tLeft = 10;
          if (tLeft + tw > vw - 10) tLeft = vw - tw - 10;
          if (tTop < 10) tTop = 10;

          tooltip.style.top = tTop + "px";
          tooltip.style.left = tLeft + "px";
        }

        function renderDots() {
          dotsEl.innerHTML = "";
          for (var i = 0; i < steps.length; i++) {
            var d = document.createElement("div");
            d.className = "tut-dot" + (i === current ? " tut-dot-active" : "");
            dotsEl.appendChild(d);
          }
        }

        var clickHandlerRef = null;
        var waitPollTimer = null;

        function clearTargetClickListener() {
          if (clickHandlerRef && clickHandlerRef.el) {
            clickHandlerRef.el.removeEventListener(
              "click",
              clickHandlerRef.fn,
              true,
            );
          }
          clickHandlerRef = null;
        }

        function goToStep(index) {
          clearTargetClickListener();
          if (waitPollTimer) {
            clearInterval(waitPollTimer);
            waitPollTimer = null;
          }

          if (index >= steps.length) {
            finishTutorial();
            return;
          }
          current = index;
          var step = steps[current];
          if (typeof step.beforeShow === "function") step.beforeShow();

          function mountOnTarget() {
            var el = elFor(step);
            if (!el) {
              // target belum ada (mis. tab modal belum dirender) -> coba lagi sebentar
              setTimeout(mountOnTarget, 80);
              return;
            }
            root.style.display = "block";
            stepBadge.textContent =
              "LANGKAH " + (current + 1) + "/" + steps.length;
            titleEl.textContent = step.title;
            descEl.textContent = step.desc;
            renderDots();
            nextBtn.textContent =
              current === steps.length - 1 ? "Selesai" : "Lanjut";
            ring.classList.add("tut-pulse");

            var rect = el.getBoundingClientRect();
            positionMasksAndRing(rect);
            hand.style.display = step.advanceOnClickTarget ? "block" : "none";

            if (step.advanceOnClickTarget) {
              var fn = function () {
                if (typeof step.onAdvance === "function") step.onAdvance();
                setTimeout(function () {
                  goToStep(current + 1);
                }, 220);
              };
              clickHandlerRef = { el: el, fn: fn };
              el.addEventListener("click", fn, true);
            }
          }

          if (typeof step.waitFor === "function" && !step.waitFor()) {
            waitPollTimer = setInterval(function () {
              if (step.waitFor()) {
                clearInterval(waitPollTimer);
                waitPollTimer = null;
                mountOnTarget();
              }
            }, 100);
          } else {
            mountOnTarget();
          }
        }

        function finishTutorial() {
          root.style.display = "none";
          finishOverlay.classList.add("tut-show");
        }

        function closeTutorialCompletely() {
          root.style.display = "none";
          finishOverlay.classList.remove("tut-show");
          clearTargetClickListener();
          if (waitPollTimer) clearInterval(waitPollTimer);
          localStorage.setItem(TUT_KEY, "1");
        }

        nextBtn.addEventListener("click", function () {
          var step = steps[current];
          if (step.advanceOnClickTarget) {
            // Simulasikan klik asli pada elemen target supaya aksi nyata
            // game (buka modal, pindah tab, spawn bola) tetap terpicu --
            // listener klik yang didaftarkan goToStep() akan otomatis
            // lanjut ke step berikutnya setelah ini.
            var el = elFor(step);
            if (el) {
              el.click();
              return;
            }
          }
          goToStep(current + 1);
        });
        skipBtn.addEventListener("click", closeTutorialCompletely);
        finishBtn.addEventListener("click", closeTutorialCompletely);

        window.addEventListener("resize", function () {
          if (current < 0 || current >= steps.length) return;
          var el = elFor(steps[current]);
          if (el) positionMasksAndRing(el.getBoundingClientRect());
        });

        // Mulai tutorial setelah game selesai render awal.
        window.addEventListener("load", function () {
          setTimeout(function () {
            goToStep(0);
          }, 700);
        });
      })();

/* ==================================================
   SERVICE WORKER REGISTRATION
   ================================================== */
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker
            .register("./service-worker.js")
            .catch((err) => console.error("SW registration failed:", err));
        });
      }
