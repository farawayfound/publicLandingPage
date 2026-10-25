/* The terminal on the landing page's "Professional" card.
 * The command script below is the owner's own, copied verbatim from the original landing page.
 * Only the runner is new: it fits the number of lines to the card's height (so nothing overlaps on a narrow phone),
 * pauses while the card is off screen or the tab is hidden, and shows one still frame under prefers-reduced-motion. */
(function () {
	var terminal = document.getElementById("terminal-card");
	if (!terminal) return;
	var MAX_LINES = 9;
	var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	function p(path) {
		return '<span class="t-prompt">david@chui</span>:<span class="t-path">' + path + '</span>$ ';
	}
	function cmd(t) { return '<span class="t-cmd">' + t + '</span>'; }
	function out(t) { return '<span class="t-out">' + t + '</span>'; }
	function ok(t)  { return '<span class="t-ok">'  + t + '</span>'; }
	function wrn(t) { return '<span class="t-warn">'+ t + '</span>'; }

	/* Each entry: html string + pause (ms) before next line appears */
	const script = [
		// ── git status & branch ──
		{ h: p("~/dev") + cmd("git status"),                                          ms: 480  },
		{ h: out("On branch main · Your branch is up to date."),                      ms: 150  },
		{ h: out("nothing to commit, working tree clean"),                            ms: 900  },
		{ h: p("~/dev") + cmd("git checkout -b feat/dark-mode"),                      ms: 380  },
		{ h: out("Switched to a new branch 'feat/dark-mode'"),                        ms: 850  },
		// ── diff & commit ──
		{ h: p("~/dev") + cmd("git diff --stat"),                                     ms: 320  },
		{ h: out("src/styles/theme.css  |  +47  -3"),                                 ms: 130  },
		{ h: out("1 file changed, 47 insertions(+), 3 deletions(-)"),                 ms: 750  },
		{ h: p("~/dev") + cmd("git add -A && git commit -m 'feat: dark-mode'"),       ms: 420  },
		{ h: out("[feat/dark-mode a3f9c12] feat: dark-mode"),                         ms: 900  },
		// ── npm test ──
		{ h: p("~/dev") + cmd("npm test -- --coverage"),                              ms: 650  },
		{ h: wrn("⚙  Running test suite..."),                                         ms: 620  },
		{ h: out("PASS  src/__tests__/theme.test.js"),                                ms: 180  },
		{ h: out("PASS  src/__tests__/App.test.js"),                                  ms: 180  },
		{ h: out("PASS  src/__tests__/router.test.js"),                               ms: 200  },
		{ h: ok("Tests: 27 passed · Coverage: 91.4% · Time: 4.2s"),                   ms: 880  },
		// ── npm build ──
		{ h: p("~/dev") + cmd("npm run build"),                                       ms: 580  },
		{ h: out("&gt; react-scripts build --profile"),                               ms: 400  },
		{ h: wrn("⚙  Creating optimized production build..."),                        ms: 850  },
		{ h: ok("✓  Compiled in 3.12s · bundle: 248 kB gzipped"),                     ms: 780  },
		// ── push & PR ──
		{ h: p("~/dev") + cmd("git push origin feat/dark-mode"),                      ms: 430  },
		{ h: out("Enumerating objects: 9 · Compressing: 100%"),                       ms: 200  },
		{ h: ok("✓  feat/dark-mode → origin  [davidchui/portfolio]"),                 ms: 680  },
		{ h: p("~/dev") + cmd('gh pr create --title "feat: dark mode" --fill'),       ms: 480  },
		{ h: ok("✓  PR #42 created · github.com/davidchui/portfolio/pull/42"),        ms: 950  },
		// ── docker build & push ──
		{ h: p("~/dev") + cmd("docker build -t portfolio:latest ."),                  ms: 580  },
		{ h: out("Step 1/8 : FROM node:20-alpine"),                                   ms: 200  },
		{ h: out("Step 4/8 : RUN npm ci --omit=dev"),                                 ms: 220  },
		{ h: out("Step 8/8 : CMD [\"node\", \"server.js\"]"),                         ms: 280  },
		{ h: ok("✓  Successfully built  portfolio:latest"),                            ms: 680  },
		{ h: p("~/dev") + cmd("docker push portfolio:latest"),                        ms: 480  },
		{ h: out("Pushing layers: 100% ████████████████  12/12"),                     ms: 380  },
		{ h: ok("✓  digest: sha256:8d3f9a…  pushed"),                                 ms: 900  },
		// ── SSH deploy ──
		{ h: p("~/dev") + cmd("ssh deploy@davidchui.work 'systemctl restart app'"),  ms: 520  },
		{ h: out("Connected to davidchui.work  (uptime: 47d 3h 12m)"),               ms: 300  },
		{ h: ok("● portfolio.service  active (running)"),                              ms: 950  },
		// ── Python sitemap ──
		{ h: p("~/analytics") + cmd("python3 generate_sitemap.py --verbose"),         ms: 580  },
		{ h: out("Scanning /dist/**/*.html  →  38 routes found"),                     ms: 280  },
		{ h: out("Adding lastmod timestamps from git log..."),                        ms: 380  },
		{ h: ok("✓  sitemap.xml written  (38 URLs · 4.1 kB)"),                        ms: 870  },
		// ── curl health check ──
		{ h: p("~") + cmd("curl -s https://davidchui.work/health | jq ."),           ms: 520  },
		{ h: out('{ "status": "ok", "uptime": 170124, "v": "2.4.1" }'),              ms: 900  },
		// ── grep ──
		{ h: p("~/dev/src") + cmd('grep -r "useTheme" --include="*.tsx" -l'),        ms: 380  },
		{ h: out("components/Navbar.tsx"),                                             ms: 100  },
		{ h: out("components/Settings.tsx"),                                           ms: 100  },
		{ h: out("pages/Home.tsx"),                                                    ms: 780  },
		// ── git log ──
		{ h: p("~/dev") + cmd("git log --oneline -5"),                                ms: 330  },
		{ h: out("a3f9c12  feat: dark-mode toggle"),                                  ms: 100  },
		{ h: out("b18e741  fix: mobile nav z-index"),                                 ms: 100  },
		{ h: out("d9c3301  chore: bump dependencies"),                                ms: 100  },
		{ h: out("f551208  feat: project filter component"),                          ms: 100  },
		{ h: out("3a8d990  init: project scaffolding"),                               ms: 880  },
		// ── pip + python lint ──
		{ h: p("~/analytics") + cmd("pip install -r requirements.txt -q"),            ms: 650  },
		{ h: wrn("⚙  Resolving dependencies..."),                                     ms: 520  },
		{ h: ok("✓  All packages installed"),                                          ms: 820  },
		{ h: p("~/analytics") + cmd("flake8 . --max-line-length=100"),                ms: 380  },
		{ h: ok("✓  No issues found"),                                                 ms: 900  },
		// ── node & versions ──
		{ h: p("~") + cmd("node -v && npm -v && python3 --version"),                  ms: 320  },
		{ h: out("v20.12.0  ·  npm 10.5.0  ·  Python 3.11.9"),                       ms: 880  },
		// ── lighthouse ──
		{ h: p("~/dev") + cmd("npx lighthouse https://davidchui.work --quiet"),       ms: 700  },
		{ h: wrn("⚙  Analyzing page performance..."),                                  ms: 950  },
		{ h: ok("Performance: 98  ·  Accessibility: 100  ·  SEO: 100"),               ms: 950  },
		// ── final cursor ──
		{ h: p("~/dev") + '<span class="t-cursor"></span>',                           ms: 3200 },
			];

	function fitLines() {
		var cs = getComputedStyle(terminal);
		var lh = parseFloat(cs.fontSize) * 1.52;
		var inner = terminal.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
		MAX_LINES = Math.max(5, Math.floor(inner / lh));
	}

	function addLine(html) {
		var div = document.createElement("div");
		div.className = "t-line";
		div.innerHTML = html;
		terminal.appendChild(div);
		while (terminal.children.length > MAX_LINES) {
			terminal.removeChild(terminal.firstChild);
		}
	}

	fitLines();
	window.addEventListener("resize", fitLines);

	/* reduced motion: one still frame (the markup already carries it; the script only reveals it) */
	if (reduce) {
		var still = terminal.querySelector(".t-static");
		if (still) { still.style.display = "block"; still.removeAttribute("aria-hidden"); }
		return;
	}

	terminal.innerHTML = "";
	var visible = true;
	if ("IntersectionObserver" in window) {
		new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(terminal);
	}

	function run(i) {
		if (!visible || document.hidden) { setTimeout(function () { run(i); }, 400); return; }
		if (i >= script.length) {
			setTimeout(function () { terminal.innerHTML = ""; run(0); }, 600);
			return;
		}
		addLine(script[i].h);
		setTimeout(function () { run(i + 1); }, script[i].ms);
	}
	run(0);
})();
