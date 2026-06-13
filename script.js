document.addEventListener('DOMContentLoaded', () => {
    // --- LIVE BACKEND API ---
    const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbwAXwtj3cjByPdhY3XfawwPRtENVamfi-EUcSW5ZAEjyLkAR1z0Y-AzksWaXAZ4N7b3/exec';

    // --- VOICE & ROUTINE STATE ---
    const synth = window.speechSynthesis;
    let isRoutineActive = false;
    let stopRoutineFlag = false;
    let skipToNextFlag  = false;   // set by "Next Exercise" button
    let selectedVoice  = null;

    // --- NEW WEIGHT GAIN EXERCISES (use simple counting, not cue-per-rep) ---
    const NEW_EXERCISES = new Set([
        'overhead to cross-body arm swings',
        'knee push-ups',
        'overhead press',
        'chair dips',
        'lying pullover'
    ]);
    const isNewExercise = name => NEW_EXERCISES.has(name.toLowerCase().trim());

    // --- VOICE CONFIGURATION ---
    function loadVoices() {
        const voices = synth.getVoices();
        selectedVoice = voices.find(v => v.name.includes('Google US English')) ||
                        voices.find(v => v.name.includes('Zira')) ||
                        voices.find(v => v.name.includes('Samantha')) ||
                        voices.find(v => v.name.includes('Female')) ||
                        voices[0];
    }

    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    // --- SPEAK UTILITY ---
    function speak(text, rate = 0.9) {
        return new Promise((resolve) => {
            if (stopRoutineFlag) { resolve(0); return; }
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = selectedVoice;
            utterance.rate = rate;
            utterance.pitch = 1.0;
            const startTime = Date.now();
            utterance.onend = () => { resolve(Date.now() - startTime); };
            utterance.onerror = () => { resolve(0); };
            synth.speak(utterance);
        });
    }

    function delay(ms) {
        return new Promise(resolve => {
            if (stopRoutineFlag || skipToNextFlag) { resolve(); return; }
            const end = Date.now() + ms;
            const tick = () => {
                if (stopRoutineFlag || skipToNextFlag || Date.now() >= end) { resolve(); }
                else { setTimeout(tick, 50); }
            };
            setTimeout(tick, 50);
        });
    }

    // --- INTERVAL COUNTDOWN UTILITY (5s intervals) ---
    function runIntervalCount(totalSeconds, rate = 1.1) {
        return new Promise((resolve) => {
            if (stopRoutineFlag || skipToNextFlag) { resolve(); return; }
            let current = 0;
            const timer = setInterval(() => {
                if (stopRoutineFlag || skipToNextFlag) { clearInterval(timer); resolve(); return; }
                current++;
                if (current % 5 === 0) {
                    synth.cancel();
                    const utt = new SpeechSynthesisUtterance(String(current));
                    utt.voice = selectedVoice;
                    utt.rate = rate;
                    synth.speak(utt);
                }
                if (current >= totalSeconds) { clearInterval(timer); setTimeout(resolve, 1000); }
            }, 1000);
        });
    }

    // --- PARSING HELPERS ---
    function parseToNumber(str) {
        if (!str || str === '-') return 0;
        return parseInt(str.replace(/[^0-9]/g, '')) || 0;
    }
    function parseSeconds(str) {
        if (!str || str === '-') return 0;
        let num = parseToNumber(str);
        if (str.toLowerCase().includes('min')) return num * 60;
        return num;
    }

    // --- EXERCISE CUES (original simple system for period/weekly exercises) ---
    function getInstructionCues(exerciseName) {
        const name = exerciseName.toLowerCase();
        if (name.includes('squat'))                                    return { up: "Lower down slowly...",          down: "And... Up." };
        if (name.includes('bridge') || name.includes('glute bridge'))  return { up: "Lift your hips high...",         down: "Lower to the floor." };
        if (name.includes('lunge') || name.includes('front lunge'))    return { up: "Step forward...",                down: "Push back." };
        if (name.includes('twist'))                                     return { up: "Gentle twist...",                down: "Return to center." };
        if (name.includes('tilt'))                                      return { up: "Tilt pelvis up...",              down: "Release." };
        if (name.includes('cobra'))                                     return { up: "Lift your chest...",             down: "Lower back down." };
        if (name.includes('plank'))                                     return { up: "Hold strong...",                 down: "Breathe steadily." };
        return { up: "Begin movement...", down: "Relax." };
    }

    // --- UI HELPERS ---
    function highlightExercise(index, isActive, contextId = 'today-routine') {
        const cardId = contextId === 'today-routine'
            ? `exercise-card-${index}`
            : `routine-${contextId}-exercise-${index}`;
        const card = document.getElementById(cardId);
        if (card) {
            if (isActive) {
                card.classList.add('active-exercise-card');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                card.classList.remove('active-exercise-card');
            }
        }
    }

    // --- NEXT EXERCISE BUTTON HELPERS ---
    function addNextExerciseButton(anchorBtn) {
        removeNextExerciseButton();
        const nextBtn = document.createElement('button');
        nextBtn.id = 'next-exercise-btn';
        nextBtn.innerHTML = '<i class="fas fa-forward-step mr-2"></i>Next Exercise';
        nextBtn.className = 'mt-2 w-full bg-yellow-400 text-gray-900 font-bold py-3 rounded-full shadow-lg hover:bg-yellow-300 transition-transform transform active:scale-95 flex justify-center items-center';
        nextBtn.addEventListener('click', () => {
            skipToNextFlag = true;
            synth.cancel();
        });
        anchorBtn.parentNode.insertBefore(nextBtn, anchorBtn.nextSibling);
    }
    function removeNextExerciseButton() {
        document.getElementById('next-exercise-btn')?.remove();
    }

    // --- CORE ROUTINE RUNNER ---
    async function runFullRoutine(exercises, buttonId, contextId = 'today-routine') {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const originalText    = btn.innerHTML;
        const originalClasses = btn.className;

        btn.innerHTML = '<i class="fas fa-stop mr-2"></i>Stop Routine';
        btn.classList.remove('bg-accent', 'text-accent', 'bg-white');
        btn.classList.add('bg-red-500', 'text-white', 'pulse-red');

        isRoutineActive = true;
        stopRoutineFlag = false;
        skipToNextFlag  = false;

        addNextExerciseButton(btn);

        if (!selectedVoice) loadVoices();

        // Filter out pure walk/cardio entries (no automated cues possible)
        const activeExercises = exercises
            .map((ex, i) => ({ ...ex, originalIndex: i }))
            .filter(ex => !ex.name.toLowerCase().includes('walk') &&
                          !ex.name.toLowerCase().includes('zumba') &&
                          !ex.name.toLowerCase().includes('cycling') &&
                          !ex.name.toLowerCase().includes('dancing') &&
                          !ex.name.toLowerCase().includes('massage'));

        await speak("Let's begin your practice. Find a comfortable space.", 0.9);
        await delay(1500);

        for (let i = 0; i < activeExercises.length; i++) {
            if (stopRoutineFlag) break;

            // Reset skip flag at start of each exercise
            skipToNextFlag = false;

            const exercise    = activeExercises[i];
            const originalIndex = exercise.originalIndex;

            highlightExercise(originalIndex, true, contextId);

            // --- ANNOUNCE EXERCISE NAME ---
            await speak(`Next up... ${exercise.name}.`, 0.9);
            await delay(1000);

            // --- PARSE EXERCISE DATA ---
            const sets     = parseToNumber(exercise.sets) || 1;
            const reps     = parseToNumber(exercise.reps);
            const holdSec  = parseSeconds(exercise.hold);
            const restSec  = parseSeconds(exercise.rest);

            const isCatCow      = exercise.name.toLowerCase().includes('cat');
            const isBreathing   = exercise.name.toLowerCase().includes('breath') ||
                                  exercise.name.toLowerCase().includes('meditation');
            const isRepAndHold  = (reps > 1 && holdSec > 0);
            const isStaticHold  = (holdSec > 0 && reps <= 1);
            const isStandardRep = (reps > 0 && holdSec === 0);

            // ============================================================
            // NEW WEIGHT-GAIN EXERCISES — simple count, no per-rep cues
            // ============================================================
            if (isNewExercise(exercise.name)) {
                await speak(`Get ready. ${reps} reps.`, 0.9);
                await delay(3000);  // time to get into position
                if (stopRoutineFlag || skipToNextFlag) { highlightExercise(originalIndex, false, contextId); continue; }
                await speak("Ready... Go.", 0.95);
                await delay(800);

                // These exercises use a 1700ms count gap (0.5s faster than default 2200ms)
                const _n = exercise.name.toLowerCase();
                const countDelay = (_n.includes('pullover') || _n.includes('arm swing') || _n.includes('overhead press')) ? 1700 : 2200;

                for (let r = 1; r <= reps; r++) {
                    if (stopRoutineFlag || skipToNextFlag) break;
                    await speak(String(r), 1.15);
                    await delay(countDelay);
                }

                if (!stopRoutineFlag && !skipToNextFlag) await speak("Good.", 0.9);

                // Rest between sets (for new exercises, sets > 1 unlikely but handle anyway)
                if (restSec > 0) {
                    await speak(`Rest. ${restSec} seconds.`, 0.9);
                    await delay(restSec * 1000);
                }

            } else {
                // ============================================================
                // ORIGINAL VOICE BEHAVIOR for period/weekly exercises
                // ============================================================
                const cues = getInstructionCues(exercise.name);

                for (let currentSet = 1; currentSet <= sets; currentSet++) {
                    if (stopRoutineFlag || skipToNextFlag) break;

                    if (sets > 1) {
                        await speak(`Set ${currentSet}.`, 0.9);
                        await delay(800);
                    }

                    // --- A. CAT-COW ---
                    if (isCatCow) {
                        await speak("Come to all fours. Hands under shoulders.", 0.9);
                        await delay(3000);
                        const rounds = reps > 0 ? reps : 10;
                        for (let r = 1; r <= rounds; r++) {
                            if (stopRoutineFlag || skipToNextFlag) break;
                            await speak("Inhale... Drop your belly... Look up.", 0.85);
                            await delay(3500);
                            await speak("Exhale... Round your spine... Chin to chest.", 0.85);
                            await delay(3500);
                        }

                    // --- B. BREATHING / MEDITATION ---
                    } else if (isBreathing) {
                        await speak("Inhale slowly through your nose...", 0.8);
                        await delay(4000);
                        await speak("Exhale fully through your mouth.", 0.8);
                        await delay(4000);
                        if (holdSec > 10) { await runIntervalCount(holdSec, 1.0); }
                        else { await delay((holdSec || 30) * 1000); }
                        await speak("Gently open your eyes. Take one more deep breath.", 0.85);

                    // --- C. REPS + HOLD (Glute Bridge 2s hold etc.) ---
                    } else if (isRepAndHold) {
                        await speak("Get ready... Begin.", 0.9);
                        await delay(1000);
                        for (let r = 1; r <= reps; r++) {
                            if (stopRoutineFlag || skipToNextFlag) break;
                            await speak(`${cues.up}... and Hold.`, 1.0);
                            await runIntervalCount(holdSec, 1.2);
                            await speak(`${cues.down} ${r}`, 1.0);
                            await delay(2000);
                        }

                    // --- D. STATIC HOLD (Plank, stretches) ---
                    } else if (isStaticHold) {
                        await speak("Move into position... Lift... and Hold.", 0.9);
                        await delay(1000);
                        await runIntervalCount(holdSec, 1.2);
                        await speak("Gently release.", 0.9);

                    // --- E. STANDARD REPS (Squats, Lunges, Pelvic Tilts) ---
                    } else if (isStandardRep) {
                        await speak("Prepare... Go.", 0.9);
                        await delay(1000);
                        for (let r = 1; r <= reps; r++) {
                            if (stopRoutineFlag || skipToNextFlag) break;
                            await speak(cues.up, 1.0);
                            await delay(1500);
                            await speak(`${cues.down} ${r}`, 1.0);
                            await delay(1500);
                        }
                    }

                    // --- REST BETWEEN SETS ---
                    const isLastExercise = (i === activeExercises.length - 1);
                    const isLastSet      = (currentSet === sets);
                    if (restSec > 0 && !(isLastExercise && isLastSet) && !skipToNextFlag) {
                        await speak("Rest... Breathe deeply.", 0.9);
                        if (restSec > 10) {
                            await runIntervalCount(restSec, 1.2);
                        } else {
                            for (let r = 1; r <= restSec; r++) {
                                if (stopRoutineFlag || skipToNextFlag) break;
                                await speak(String(r), 1.2);
                                await delay(800);
                            }
                        }
                    }
                } // end set loop
            } // end old/new branch

            highlightExercise(originalIndex, false, contextId);

            // Gap before next exercise — give time to reposition
            if (i < activeExercises.length - 1 && !stopRoutineFlag) {
                skipToNextFlag = false;  // reset after each exercise completes
                await delay(1500);
            }
        } // end exercise loop

        if (!stopRoutineFlag) {
            await delay(1000);
            await speak("Namaste. Great practice today.", 0.9);
        }

        resetRoutineUI(btn, originalText, originalClasses);
    }

    function resetRoutineUI(btn, text, classes) {
        stopRoutineFlag = true;
        isRoutineActive = false;
        synth.cancel();
        removeNextExerciseButton();
        if (btn) { btn.innerHTML = text; btn.className = classes; }
        document.querySelectorAll('.active-exercise-card').forEach(el => el.classList.remove('active-exercise-card'));
    }

    window.handleGlobalStop = function () {
        stopRoutineFlag = true;
        isRoutineActive = false;
        synth.cancel();
        removeNextExerciseButton();
        document.querySelectorAll('.active-exercise-card').forEach(el => el.classList.remove('active-exercise-card'));
    };

    // --- API & DATA HANDLING ---
    const api = {
        login: async (userId, password) => {
            const response = await fetch(`${googleScriptUrl}?action=login&userId=${userId}&password=${password}`);
            return response.json();
        },
        signUp: async (userId, password) => {
            await fetch(googleScriptUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'signUp', userId, password })
            });
            return await api.login(userId, password);
        },
        getUserData: async (userId) => {
            const response = await fetch(`${googleScriptUrl}?action=getUserData&userId=${userId}`);
            return response.json();
        },
        saveLog: async (userId, logData) => {
            await fetch(googleScriptUrl, {
                method: 'POST', mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'saveLog', userId, logData })
            });
            return { success: true };
        }
    };

    // --- MEDIA MAP ---
    // mp4: muted looping videos | gif: animated guide | jpg: static images
    const imageMap = {
        // --- NEW WEIGHT GAIN EXERCISES (MP4 videos) ---
        'Overhead to Cross-Body Arm Swings': {
            mp4: 'images/Overhead to Cross-Body Arm Swings.mp4', gif: null, jpg: []
        },
        'Knee Push-ups': {
            mp4: 'images/knee push ups.mp4', gif: null, jpg: []
        },
        'Overhead Press': {
            mp4: 'images/overhead press.mp4', gif: null, jpg: []
        },
        'Chair Dips': {
            mp4: 'images/chair dips.mp4', gif: null, jpg: []
        },
        'Lying Pullover': {
            mp4: 'images/lying pullover .mp4', gif: null, jpg: []
        },
        // --- EXISTING EXERCISES (GIFs + JPGs) ---
        'Cat\u2013Cow Pose':           { mp4: null, gif: 'images/cat_cow.gif',              jpg: ['images/cat_cow.jpg'] },
        'Child\u2019s Pose':           { mp4: null, gif: "images/child's pose.gif",          jpg: ['images/child.jpg', 'images/child_1.jpg'] },
        'Bridge Pose':                 { mp4: null, gif: 'images/bridge.gif',               jpg: ['images/bridge.jpg', 'images/bridge_1.jpg'] },
        'Seated Forward Bend':         { mp4: null, gif: 'images/Seated Forward Bend.gif',  jpg: ['images/Seated Forward Bend.jpg', 'images/Seated Forward Bend_1.jpg'] },
        'Bodyweight Squats':           { mp4: null, gif: 'images/Squats.gif',               jpg: ['images/Squats.jpg', 'images/Squats_1.jpg'] },
        'Front Lunges':                { mp4: null, gif: 'images/Lunges.gif',               jpg: ['images/Lunges.jpg'] },
        'Forward Lunges':              { mp4: null, gif: 'images/Lunges.gif',               jpg: ['images/Lunges.jpg'] },
        'Glute Bridge':                { mp4: null, gif: 'images/Glute Bridges.gif',        jpg: ['images/Glute Bridges.jpg'] },
        'Butterfly Stretch':           { mp4: null, gif: null,                              jpg: ['images/Butterfly Stretch.jpg'] },
        'Pelvic Tilts':                { mp4: null, gif: 'images/pelvic_tilt.gif',          jpg: [] },
        'Cobra Pose':                  { mp4: null, gif: 'images/Cobra-Pose.gif',           jpg: ['images/Cobra Pose.webp'] },
        'Reclined Twist':              { mp4: null, gif: 'images/reclined twist.gif',       jpg: ['images/Reclined Twist.jpg'] },
        'Plank':                       { mp4: null, gif: null,                              jpg: ['images/Plank.jpg'] },
        'Brisk Walk / Light Dance':    { mp4: null, gif: null,                              jpg: ['images/walking.jpg'] },
        'Warm-up Walk':                { mp4: null, gif: null,                              jpg: ['images/walking.jpg'] },
        'Gentle Yoga / Slow Walk':     { mp4: null, gif: null,                              jpg: ['images/walking.jpg'] },
        'Walking / Zumba / Cycling / Dancing': { mp4: null, gif: null,                     jpg: ['images/walking.jpg'] },
        'Deep Breathing':              { mp4: null, gif: null,                              jpg: ['images/breathing.jpg'] },
        'Deep Belly Breathing':        { mp4: null, gif: null,                              jpg: ['images/breathing.jpg'] },
        'Meditation / Mindful Breathing': { mp4: null, gif: null,                          jpg: ['images/breathing.jpg'] },
        'Deep Breathing / Meditation': { mp4: null, gif: null,                             jpg: ['images/breathing.jpg'] },
    };

    // ===================================================================
    //  BLENDED 7-DAY ROUTINE DATA
    //  Order per day: Warm-up → Heavy Compound → Upper Body → 
    //                 Period Relief / Core → Cool-down Stretch → Breathing
    // ===================================================================
    const routineData = [
        // ---------------------------------------------------------------
        // MONDAY — Full Body Power Flow
        // ---------------------------------------------------------------
        {
            day: 'Monday',
            title: 'Full Body Power Flow',
            goal: 'Activate full body, build strength, relax lower back & abdomen.',
            exercises: [
                {
                    name: 'Brisk Walk / Light Dance',
                    sets: '-', reps: '-', hold: '5 min', rest: '-',
                    instructions: '🔥 WARM-UP: Get your blood flowing. Walk briskly or dance lightly for 5 minutes. Swing your arms, move your hips. Get warm!'
                },
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 WARM-UP: Stand tall, feet shoulder-width apart. Swing both arms straight up overhead, then bring them down to cross in front of your chest. Rhythmic and continuous. Warms up shoulders, chest, and spine.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Feet shoulder-width apart, toes slightly out. Lower your hips like sitting into a chair. Keep your chest up and knees tracking your toes. Drive through your heels to stand. Beginner: 1×8 reps.'
                },
                {
                    name: 'Front Lunges',
                    sets: '1', reps: '10', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Stand tall. Step one foot forward, lower your back knee toward the floor. Push off the front foot to return. Alternate legs — 5 each side = 10 total. Keep your torso upright.'
                },
                {
                    name: 'Knee Push-ups',
                    sets: '1', reps: '5', hold: '-', rest: '30 sec',
                    instructions: '💪 UPPER BODY: Knees on mat, hands slightly wider than shoulders, body in a straight line from knees to head. Lower chest to floor slowly, push back up. Beginner: 1×5 reps.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '12', hold: '-', rest: '20 sec',
                    instructions: '💪 SHOULDERS: Stand or sit tall. Arms at shoulder height, elbows bent at 90°. Press both arms straight overhead until fully extended. Lower slowly back to start. 1×12 reps.'
                },
                {
                    name: 'Chair Dips',
                    sets: '1', reps: '6', hold: '-', rest: '30 sec',
                    instructions: '💪 TRICEPS: Sit at edge of a sturdy chair, hands on seat. Slide off the edge, support your weight with arms. Bend elbows to ~90°, lower body, then push back up. Beginner: 1×6 reps.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 CHEST/BACK: Lie on your back, arms extended up over your chest. Slowly lower arms back behind your head toward the floor (slight bend in elbows), then sweep back up. 1×8 reps. Great for chest expansion.'
                },
                {
                    name: 'Cat\u2013Cow Pose',
                    sets: '1', reps: '10 rounds', hold: '~1 min total', rest: '10 sec',
                    instructions: '🧘 CORE MOBILITY: All fours, hands under shoulders. Inhale → drop belly, look up (Cow). Exhale → round spine, chin to chest (Cat). 10 rounds, flowing with breath.'
                },
                {
                    name: 'Bridge Pose',
                    sets: '2', reps: '1', hold: '20 sec', rest: '20 sec',
                    instructions: '🧘 GLUTES/BACK: Lie on back, knees bent, feet flat. Press hips up and hold 20 seconds, squeezing glutes. Lower slowly. 2 sets.'
                },
                {
                    name: 'Seated Forward Bend',
                    sets: '1', reps: '1', hold: '2 min', rest: '15 sec',
                    instructions: '🌿 COOL-DOWN: Sit tall, legs out. Hinge at hips and reach forward. Hold gently for 2 minutes. Let tension release with each exhale.'
                },
                {
                    name: 'Child\u2019s Pose',
                    sets: '1', reps: '1', hold: '2 min', rest: '-',
                    instructions: '🌿 COOL-DOWN: Knees wide, sit hips to heels, arms stretched forward. Forehead on mat. Full rest position. 2 minutes.'
                },
                {
                    name: 'Deep Breathing',
                    sets: '1', reps: '-', hold: '2 min', rest: '-',
                    instructions: '🌬️ FINISH: Sit or lie comfortably. 4 counts in through nose, 6 counts out through mouth. Let your entire body relax completely.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // TUESDAY — Lower Body Powerhouse
        // ---------------------------------------------------------------
        {
            day: 'Tuesday',
            title: 'Lower Body Powerhouse',
            goal: 'Strengthen pelvic & leg muscles, build lower body mass.',
            exercises: [
                {
                    name: 'Warm-up Walk',
                    sets: '-', reps: '-', hold: '5 min', rest: '-',
                    instructions: '🔥 WARM-UP: Brisk walk for 5 minutes. Pump your arms, pick up the pace. Get your legs warm before we work them hard.'
                },
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 WARM-UP: Stand tall. Swing arms overhead then cross in front. 20 continuous reps. Wakes up your upper body and spine before lower body work.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Feet shoulder-width, toes slightly outward. Sit into the squat, chest up, knees track toes. Push through heels to rise. 1×8 reps beginner.'
                },
                {
                    name: 'Front Lunges',
                    sets: '1', reps: '10', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Step forward, lower back knee, push back. Alternate legs. 5 reps per leg = 10 total. Keep torso upright throughout.'
                },
                {
                    name: 'Glute Bridge',
                    sets: '2', reps: '15', hold: '2 sec', rest: '30 sec',
                    instructions: '🧘 GLUTES + PELVIC FLOOR: Lie on back, knees bent. Drive hips up, squeeze glutes and hold 2 seconds at the top. Lower slowly. 2 sets × 15 reps. Excellent for pelvic floor strength.'
                },
                {
                    name: 'Knee Push-ups',
                    sets: '1', reps: '5', hold: '-', rest: '30 sec',
                    instructions: '💪 UPPER BODY: Knees on mat, body straight from knees to head. Lower chest, push back up. Light set today — legs are the main focus.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '12', hold: '-', rest: '20 sec',
                    instructions: '💪 SHOULDERS: Arms to 90° at shoulder height, press overhead, lower slowly. 1×12 reps.'
                },
                {
                    name: 'Chair Dips',
                    sets: '1', reps: '6', hold: '-', rest: '30 sec',
                    instructions: '💪 TRICEPS: Hands on chair edge, slide off, lower body by bending elbows, press back up. 1×6 reps.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 CHEST: Lie on back, arms over chest. Lower arms behind head, sweep back up. 1×8 reps. Controls breathing and opens the chest.'
                },
                {
                    name: 'Butterfly Stretch',
                    sets: '1', reps: '1', hold: '2 min', rest: '15 sec',
                    instructions: '🌿 COOL-DOWN: Soles of feet together, knees fall open. Sit tall, hold feet. Let knees relax toward the floor. Hold 2 minutes — great hip and groin release after leg work.'
                },
                {
                    name: 'Deep Breathing',
                    sets: '1', reps: '-', hold: '2 min', rest: '-',
                    instructions: '🌬️ FINISH: Close your eyes. Breathe slowly and deeply. Let your legs fully relax. You worked hard today.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // WEDNESDAY — Core & Upper Body Day
        // ---------------------------------------------------------------
        {
            day: 'Wednesday',
            title: 'Core & Upper Body Day',
            goal: 'Strengthen core & chest, ease cramps, improve flexibility.',
            exercises: [
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 WARM-UP: Stand tall. 20 continuous arm swings overhead then crossing in front. Warms up shoulders and chest perfectly before upper body work.'
                },
                {
                    name: 'Cat\u2013Cow Pose',
                    sets: '1', reps: '10 rounds', hold: '-', rest: '10 sec',
                    instructions: '🔥 WARM-UP: All fours, hands under shoulders. Flow through 10 rounds of Cat-Cow to warm up the spine before core work.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Maintain leg strength — 1 light set. Feet shoulder-width, sit into squat, push through heels.'
                },
                {
                    name: 'Front Lunges',
                    sets: '1', reps: '10', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: 1 maintenance set. Step forward, lower back knee, push back. 5 each leg.'
                },
                {
                    name: 'Knee Push-ups',
                    sets: '1', reps: '5', hold: '-', rest: '30 sec',
                    instructions: '💪 UPPER BODY: Today is upper body focus. Knees on mat, full range of motion, chest touches near the floor. 1×5 reps beginner.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '12', hold: '-', rest: '20 sec',
                    instructions: '💪 SHOULDERS: Press both arms overhead from 90° position. 1×12 reps. Focus on full extension overhead.'
                },
                {
                    name: 'Chair Dips',
                    sets: '1', reps: '6', hold: '-', rest: '30 sec',
                    instructions: '💪 TRICEPS: Edge of chair, lower and press. Full range — go until elbows hit 90°. 1×6 reps.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 CHEST EXPANSION: Lie down, arms over chest. Lower behind head, sweep forward. 1×8 reps. Great chest opener after push work.'
                },
                {
                    name: 'Cobra Pose',
                    sets: '2', reps: '1', hold: '30 sec', rest: '15 sec',
                    instructions: '🧘 PERIOD RELIEF: Lie face down, hands under shoulders. Press up to lift chest off floor, hold 30 seconds. Stretches abdomen and relieves cramp tension. 2 sets.'
                },
                {
                    name: 'Pelvic Tilts',
                    sets: '1', reps: '10', hold: '2 sec', rest: '10 sec',
                    instructions: '🧘 CORE + PELVIS: Lie on back, knees bent. Press lower back into floor (tilt pelvis), hold 2 seconds, release. 10 reps. Strengthens core and relieves lower back pain.'
                },
                {
                    name: 'Bridge Pose',
                    sets: '2', reps: '1', hold: '20 sec', rest: '20 sec',
                    instructions: '🧘 POSTERIOR CHAIN: Lie on back, hips up, squeeze glutes, hold 20 seconds. 2 sets.'
                },
                {
                    name: 'Seated Forward Bend',
                    sets: '1', reps: '1', hold: '2 min', rest: '15 sec',
                    instructions: '🌿 COOL-DOWN: Sit tall, legs extended. Fold forward gently and hold 2 minutes. Deep release for back and hamstrings.'
                },
                {
                    name: 'Child\u2019s Pose',
                    sets: '1', reps: '1', hold: '2 min', rest: '-',
                    instructions: '🌿 COOL-DOWN: Final rest. Hips to heels, arms forward, forehead on mat. 2 minutes of complete relaxation.'
                },
                {
                    name: 'Deep Breathing',
                    sets: '1', reps: '-', hold: '2 min', rest: '-',
                    instructions: '🌬️ FINISH: Close eyes, breathe deeply for 2 minutes. Calm your nervous system after core work.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // THURSDAY — Yoga Fusion Strength
        // ---------------------------------------------------------------
        {
            day: 'Thursday',
            title: 'Yoga Fusion Strength',
            goal: 'Calm body, reduce cramps & fatigue, maintain muscle.',
            exercises: [
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 WARM-UP: 20 arm swings overhead and crossing. Gets shoulder joints warm and blood moving before movement.'
                },
                {
                    name: 'Cat\u2013Cow Pose',
                    sets: '1', reps: '10 rounds', hold: '~1 min', rest: '10 sec',
                    instructions: '🔥 WARM-UP: 10 flowing rounds of Cat-Cow breathing. Warms spine, hips, and core.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: 1 set to maintain leg strength. Controlled movement, no rush.'
                },
                {
                    name: 'Front Lunges',
                    sets: '1', reps: '10', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: 1 maintenance set. Step and lower slowly. Push back deliberately.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '12', hold: '-', rest: '20 sec',
                    instructions: '💪 SHOULDERS: Thursday gives arms a lighter day — press only, no push-ups or dips. Arms need mid-week recovery. 1×12 reps.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 CHEST/BACK: Lie on back, arms sweep behind head and back. Light and controlled. 1×8 reps.'
                },
                {
                    name: 'Bridge Pose',
                    sets: '1', reps: '1', hold: '1 min', rest: '20 sec',
                    instructions: '🧘 YOGA STRENGTH: Lie on back, drive hips up, hold for a full minute. Focus on your breath while holding.'
                },
                {
                    name: 'Reclined Twist',
                    sets: '1', reps: '1', hold: '1 min', rest: '10 sec',
                    instructions: '🧘 DETOX/SPINE: Lie on back, drop both knees to one side, gaze the other way. Hold 1 minute each side. Releases tension in lower back and organs.'
                },
                {
                    name: 'Child\u2019s Pose',
                    sets: '1', reps: '1', hold: '2 min', rest: '-',
                    instructions: '🌿 COOL-DOWN: Hips to heels, arms stretched forward, forehead on mat. Complete surrender. 2 full minutes.'
                },
                {
                    name: 'Deep Belly Breathing',
                    sets: '1', reps: '-', hold: '3 min', rest: '-',
                    instructions: '🌬️ FINISH: Lie down or sit. Place hands on belly. Breathe so deeply your belly rises. 3 minutes. This calms your nervous system and reduces cortisol.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // FRIDAY — Power & Core Finisher
        // ---------------------------------------------------------------
        {
            day: 'Friday',
            title: 'Power & Core Finisher',
            goal: 'End the week strong — full strength + core power.',
            exercises: [
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 WARM-UP: 20 arm swings. Full range of motion. Get the blood flowing before the final push of the week.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Friday squats — final leg set of the week. Strong and controlled. 1×8 reps.'
                },
                {
                    name: 'Front Lunges',
                    sets: '1', reps: '10', hold: '-', rest: '30 sec',
                    instructions: '💪 STRENGTH: Last lunge set of the week. Step, lower, push back. 5 each leg. Finish strong.'
                },
                {
                    name: 'Knee Push-ups',
                    sets: '1', reps: '5', hold: '-', rest: '30 sec',
                    instructions: '💪 UPPER BODY: Final push-up set. Focus on full range — chest near floor, fully extended at top. 1×5 reps.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '12', hold: '-', rest: '20 sec',
                    instructions: '💪 SHOULDERS: Full extension overhead. Press with intention. 1×12 reps.'
                },
                {
                    name: 'Chair Dips',
                    sets: '1', reps: '6', hold: '-', rest: '30 sec',
                    instructions: '💪 TRICEPS: Edge of chair, lower and press. Last tricep set of the week. Give it all. 1×6 reps.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 CHEST: Lie on back, sweep arms behind head and return. Last upper body isolation of the week. 1×8 reps.'
                },
                {
                    name: 'Plank',
                    sets: '2', reps: '1', hold: '20 sec', rest: '30 sec',
                    instructions: '🧘 CORE FINISHER: Forearms on mat, body in straight line. Hold for 20 seconds. Squeeze your core and glutes. Don\'t let hips sag. 2 sets. The ultimate core finisher.'
                },
                {
                    name: 'Pelvic Tilts',
                    sets: '1', reps: '10', hold: '2 sec', rest: '15 sec',
                    instructions: '🧘 CORE + PELVIS: Lie on back. Press lower back into floor, tilt pelvis, hold 2 seconds. 10 reps. After plank, this restores neutral spine.'
                },
                {
                    name: 'Bridge Pose',
                    sets: '2', reps: '1', hold: '20 sec', rest: '20 sec',
                    instructions: '🧘 POSTERIOR CHAIN: Hips up, hold 20 seconds. Last bridge of the week. Squeeze those glutes.'
                },
                {
                    name: 'Seated Forward Bend',
                    sets: '1', reps: '1', hold: '2 min', rest: '15 sec',
                    instructions: '🌿 COOL-DOWN: Sit tall, fold forward. 2 minutes. Let the entire week\'s leg tension release.'
                },
                {
                    name: 'Deep Breathing',
                    sets: '1', reps: '-', hold: '2 min', rest: '-',
                    instructions: '🌬️ FINISH: You made it to Friday. Close your eyes. Breathe deeply and celebrate your consistency.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // SATURDAY — Active Recovery
        // ---------------------------------------------------------------
        {
            day: 'Saturday',
            title: 'Active Recovery',
            goal: 'Let muscles recover, reduce soreness, calm the mind.',
            exercises: [
                {
                    name: 'Gentle Yoga / Slow Walk',
                    sets: '-', reps: '-', hold: '10 min', rest: '-',
                    instructions: '🔥 LIGHT WARM-UP: 10 minutes of a slow walk or very gentle yoga. No intensity. Just movement to promote blood flow and reduce soreness from the week.'
                },
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '15', hold: '-', rest: '15 sec',
                    instructions: '🔥 MOBILITY: 15 gentle swings today — slower pace than usual. Focus on shoulder mobility, not speed. Recover not strain.'
                },
                {
                    name: 'Overhead Press',
                    sets: '1', reps: '10', hold: '-', rest: '20 sec',
                    instructions: '💪 LIGHT MAINTENANCE: Very slow and controlled overhead press, 10 reps. No strain. Just keep the movement pattern active. No squats, lunges, push-ups, or dips today — arms and legs need recovery.'
                },
                {
                    name: 'Lying Pullover',
                    sets: '1', reps: '8', hold: '-', rest: '20 sec',
                    instructions: '💪 LIGHT CHEST: Slow, deliberate pullover. Focus on the stretch behind your head. 8 reps. This doubles as a beautiful chest and rib cage stretch.'
                },
                {
                    name: 'Cat\u2013Cow Pose',
                    sets: '1', reps: '10 rounds', hold: '-', rest: '10 sec',
                    instructions: '🧘 SPINE RECOVERY: Slow Cat-Cow to decompress the spine after a week of effort. No rush. Let each breath guide the movement.'
                },
                {
                    name: 'Butterfly Stretch',
                    sets: '1', reps: '1', hold: '2 min', rest: '-',
                    instructions: '🌿 COOL-DOWN: Soles together, knees open. Hold gently for 2 minutes. Excellent inner thigh and hip recovery stretch.'
                },
                {
                    name: 'Meditation / Mindful Breathing',
                    sets: '-', reps: '-', hold: '5 min', rest: '-',
                    instructions: '🌬️ MENTAL RESET: Sit comfortably. Close eyes. 5 minutes of mindful breathing. This is your mental recovery for the week. You deserve this.'
                },
            ]
        },

        // ---------------------------------------------------------------
        // SUNDAY — Cardio + Light Reset
        // ---------------------------------------------------------------
        {
            day: 'Sunday',
            title: 'Cardio + Light Reset',
            goal: 'Boost endorphins, keep active without straining recovery.',
            exercises: [
                {
                    name: 'Walking / Zumba / Cycling / Dancing',
                    sets: '-', reps: '-', hold: '20 min', rest: 'As needed',
                    instructions: '🔥 MAIN CARDIO: 20 minutes of your choice — walk, cycle, dance, or Zumba. This is the heart of today. Moderate intensity — you should be able to talk but feel warm. Enjoy it!'
                },
                {
                    name: 'Overhead to Cross-Body Arm Swings',
                    sets: '1', reps: '20', hold: '-', rest: '15 sec',
                    instructions: '🔥 POST-CARDIO MOBILITY: After cardio, do 20 arm swings to keep the upper body mobile and bring heart rate down gently.'
                },
                {
                    name: 'Bodyweight Squats',
                    sets: '1', reps: '8', hold: '-', rest: '30 sec',
                    instructions: '💪 LIGHT LEG ACTIVATION: 1 light set of squats. Sunday keeps legs moving without heavy load — this prepares the legs for Monday.'
                },
                {
                    name: 'Knee Push-ups',
                    sets: '1', reps: '5', hold: '-', rest: '30 sec',
                    instructions: '💪 LIGHT UPPER: 1 very light set. Sunday is a reset day — this just keeps the movement pattern alive before Monday.'
                },
                {
                    name: 'Seated Forward Bend',
                    sets: '1', reps: '1', hold: '5 min', rest: '-',
                    instructions: '🌿 COOL-DOWN: After cardio and light exercise, sit and fold forward. 5 minutes of deep hamstring and lower back recovery. Breathe into the stretch.'
                },
            ]
        },
    ];

    // ===================================================================
    //  PERIOD PLAN DATA (Days 1-5 — unchanged gentle movements)
    // ===================================================================
    const periodPlanData = [
        {
            day: 'Day 1', title: 'Rest & Gentle Flow',
            goal: 'Eases first-day cramps, calms body. SKIP weight gain exercises today.',
            exercises: [
                { name: 'Child\u2019s Pose', sets: '1', reps: '1', hold: '3 min', rest: '15 sec', instructions: 'Knees wide, hips to heels, arms stretched forward. Forehead on mat. 3 minutes of pure rest for lower back.' },
                { name: 'Cat\u2013Cow Pose', sets: '1', reps: '10 rounds', hold: '1 min', rest: '10 sec', instructions: 'All fours, slow breath-linked movement. Massages the spine and uterus gently.' },
                { name: 'Deep Belly Breathing', sets: '1', reps: '-', hold: '5 min', rest: '-', instructions: 'Lie flat. Hands on belly. Deep belly breaths for 5 minutes. Most powerful pain reliever on Day 1.' },
            ]
        },
        {
            day: 'Day 2', title: 'Gentle Yoga Stretch',
            goal: 'Reduces lower-back pain & flow discomfort.',
            exercises: [
                { name: 'Cat\u2013Cow Pose', sets: '1', reps: '10 rounds', hold: '2 min', rest: '10 sec', instructions: 'Slow, deliberate movement. Let each exhale round the spine more.' },
                { name: 'Reclined Twist', sets: '1', reps: '1', hold: '1 min', rest: '10 sec', instructions: 'Lie on back. Drop both knees to one side. Hold 1 minute each side. Relieves back tension.' },
                { name: 'Bridge Pose', sets: '2', reps: '1', hold: '20 sec', rest: '20 sec', instructions: 'Gentle bridge — lift hips softly, hold 20 seconds. Not about strength today, about releasing tension.' },
            ]
        },
        {
            day: 'Day 3', title: 'Relax & Breathe',
            goal: 'Relaxes uterus & relieves stress. Optional: very light arm swings only.',
            exercises: [
                { name: 'Child\u2019s Pose', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Restorative. Let your body be completely supported by the floor.' },
                { name: 'Seated Forward Bend', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Gentle forward fold. No forcing. Just let gravity stretch your hamstrings.' },
                { name: 'Deep Breathing / Meditation', sets: '1', reps: '-', hold: '5 min', rest: '-', instructions: 'Sit or lie. 5 minutes of mindful breathing. Mental and physical relaxation.' },
            ]
        },
        {
            day: 'Day 4', title: 'Light Movement',
            goal: 'Improves blood circulation & eases bloating. Light exercises okay.',
            exercises: [
                { name: 'Cat\u2013Cow Pose', sets: '1', reps: '10 rounds', hold: '1 min', rest: '10 sec', instructions: 'Quick spinal flow to get circulation moving.' },
                { name: 'Bridge Pose', sets: '2', reps: '1', hold: '20 sec', rest: '20 sec', instructions: 'Gentle strengthening. Energy should be returning today.' },
                { name: 'Pelvic Tilts', sets: '1', reps: '10', hold: '2 sec', rest: '10 sec', instructions: 'Lie on back, tilt pelvis, hold 2 seconds. Improves pelvic blood flow and eases bloating.' },
            ]
        },
        {
            day: 'Day 5', title: 'Restore & Stretch',
            goal: 'Final relaxation before energy fully returns.',
            exercises: [
                { name: 'Reclined Twist', sets: '1', reps: '1', hold: '1 min', rest: '10 sec', instructions: '1 minute each side. Release all remaining tension from the week.' },
                { name: 'Child\u2019s Pose', sets: '1', reps: '1', hold: '2 min', rest: '-', instructions: 'Final restorative hold. You are nearly at full energy again.' },
                { name: 'Butterfly Stretch', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Soles together, open hips. 2 minutes of hip release.' },
                { name: 'Deep Breathing', sets: '1', reps: '-', hold: '5 min', rest: '-', instructions: 'Close your eyes and breathe. Feel refreshed and proud — you made it through.' },
            ]
        },
    ];

    // --- APP STATE ---
    let currentUser = localStorage.getItem('herCycleUser');
    let displayedDate = new Date();
    let confirmationCallback = null;
    let userData = { dailyLogs: [] };
    let waterChartInstance = null;
    let progressDisplayedDate = new Date();

    const getTodayDateString = () => new Date().toISOString().split('T')[0];

    function checkAuth() {
        if (!currentUser && !window.location.pathname.endsWith('login.html')) {
            window.location.href = 'login.html';
        } else if (currentUser) {
            const usernameDisplay = document.getElementById('username-display');
            if (usernameDisplay) usernameDisplay.textContent = `Hi, ${currentUser}!`;
        }
    }

    function getOrCreateTodayLog() {
        const todayStr = getTodayDateString();
        let todayLog = userData.dailyLogs.find(log => log.date === todayStr);
        if (!todayLog) {
            todayLog = { date: todayStr, water: 0, completed: false, periodCycleDay: null };
            userData.dailyLogs.push(todayLog);
        }
        return todayLog;
    }

    // --- EXERCISE CARD HTML (with MP4 video support) ---
    function createExerciseHTML(exercise, index, contextId = 'today-routine') {
        const { name, sets, reps, hold, rest, instructions } = exercise;
        const formattedInstructions = (instructions || '').replace(/\n/g, '<br>');

        let galleryHtml = '';
        const media = imageMap[name.trim()];

        if (media) {
            // MP4 video: muted, looping, autoplay, no controls clutter
            if (media.mp4) {
                galleryHtml += `
                <video
                    src="${media.mp4}"
                    class="w-full h-56 object-cover rounded-lg mb-2 bg-black"
                    autoplay muted loop playsinline
                    preload="metadata"
                    title="${name} demonstration"
                ></video>`;
            }
            // GIF animation
            if (media.gif) {
                galleryHtml += `<img src="${media.gif}" alt="${name} animation" class="w-full h-48 object-contain rounded-lg mb-2 bg-white">`;
            }
            // Static images
            if (media.jpg && media.jpg.length > 0) {
                media.jpg.forEach(src => {
                    galleryHtml += `<img src="${src}" alt="${name} illustration" class="w-full h-48 object-contain rounded-lg mb-2 bg-white">`;
                });
            }
        }

        if (galleryHtml === '') {
            galleryHtml = `<div class="w-full h-48 bg-white rounded-lg flex items-center justify-center"><i class="fas fa-image text-4xl text-gray-300"></i></div>`;
        }

        const uniqueCardId = contextId === 'today-routine'
            ? `exercise-card-${index}`
            : `routine-${contextId}-exercise-${index}`;

        return `
        <div id="${uniqueCardId}" class="bg-secondary p-4 rounded-lg flex flex-col transition-all duration-300">
            <h3 class="font-bold text-xl text-primary text-center mb-2">${name}</h3>
            <div class="grid grid-cols-2 gap-x-4 text-center mb-4">
                <div class="font-semibold"><span class="text-gray-600 block text-sm">Sets</span> ${sets || '-'}</div>
                <div class="font-semibold"><span class="text-gray-600 block text-sm">Reps</span> ${reps || '-'}</div>
                <div class="font-semibold"><span class="text-gray-600 block text-sm">Hold</span> ${hold || '-'}</div>
                <div class="font-semibold"><span class="text-gray-600 block text-sm">Rest</span> ${rest || '-'}</div>
            </div>
            <div class="mb-4 space-y-2">${galleryHtml}</div>
            <div class="text-left">
                <strong class="text-primary">Instructions:</strong>
                <p class="text-gray-700 leading-relaxed mt-1">${formattedInstructions}</p>
            </div>
        </div>`;
    }

    function renderTodayRoutine() {
        const todayLog = userData.dailyLogs.find(l => l.date === getTodayDateString());
        const periodDay = todayLog ? todayLog.periodCycleDay : null;
        const container = document.getElementById('today-routine-container');
        if (!container) return;

        let routine;
        if (periodDay && periodDay > 0 && periodDay <= periodPlanData.length) {
            routine = periodPlanData[periodDay - 1];
        } else {
            const dayOfWeek = new Date().getDay();
            const routineIndex = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
            routine = routineData[routineIndex];
        }

        if (routine) {
            window.homePageExercises = routine.exercises;
            container.innerHTML = `
            <div class="sticky top-0 z-20 bg-white pb-4 pt-2 border-b border-gray-100 mb-4">
                <h3 class="text-2xl font-bold mb-2 text-center">${periodDay ? `Period Day ${periodDay}` : 'Today\'s'} Routine: <span class="text-accent">${routine.title}</span></h3>
                <p class="text-center text-gray-600 mb-4">${routine.goal}</p>
                <button id="home-start-btn" class="w-full bg-accent text-white font-bold py-3 rounded-full shadow-lg hover:bg-opacity-90 transition-transform transform active:scale-95 flex justify-center items-center">
                    <i class="fas fa-play mr-2"></i>Start Full Routine
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                ${routine.exercises.map((ex, i) => createExerciseHTML(ex, i, 'today-routine')).join('')}
            </div>`;

            document.getElementById('home-start-btn').addEventListener('click', () => {
                if (isRoutineActive) {
                    handleGlobalStop();
                } else {
                    runFullRoutine(window.homePageExercises, 'home-start-btn', 'today-routine');
                }
            });
        }
    }

    function createRoutineCard(routine, index, typePrefix = 'routine') {
        const contextId = `${typePrefix}-${routine.day.replace(/\s+/g, '-').toLowerCase()}`;
        const exercisesHtml = routine.exercises.map((ex, i) => createExerciseHTML(ex, i, contextId)).join('');
        const exercisesStr = encodeURIComponent(JSON.stringify(routine.exercises));
        const btnId = `btn-start-${contextId}`;

        return `
        <div class="bg-white rounded-2xl shadow-lg">
            <button class="accordion-toggle w-full text-left p-6 flex justify-between items-center">
                <div>
                    <p class="font-bold text-xl">${routine.day}: <span class="text-accent">${routine.title}</span></p>
                    <p class="text-gray-500">${routine.goal}</p>
                </div>
                <i class="fas fa-chevron-down text-xl text-accent"></i>
            </button>
            <div class="accordion-content px-6 pb-6">
                <div class="mb-6 flex justify-center sticky top-20 z-10 bg-white py-2">
                    <button id="${btnId}" onclick="handleRoutinePageStart('${btnId}', '${exercisesStr}', '${contextId}')" class="w-full md:w-1/2 bg-accent text-white font-bold py-2 rounded-full shadow hover:bg-opacity-90 flex justify-center items-center">
                        <i class="fas fa-play mr-2"></i>Start Routine
                    </button>
                </div>
                <div class="grid grid-cols-1 gap-6">
                    ${exercisesHtml}
                </div>
            </div>
        </div>`;
    }

    window.handleRoutinePageStart = function (btnId, encodedExercises, contextId) {
        if (isRoutineActive) {
            handleGlobalStop();
        } else {
            const exercises = JSON.parse(decodeURIComponent(encodedExercises));
            runFullRoutine(exercises, btnId, contextId);
        }
    };

    function renderConsistencyCalendar() {
        const calendar = document.getElementById('consistency-calendar');
        const title = document.getElementById('calendar-title');
        if (!calendar || !title) return;
        const month = displayedDate.getMonth();
        const year = displayedDate.getFullYear();
        title.textContent = `${displayedDate.toLocaleString('default', { month: 'long' })} ${year}`;
        calendar.innerHTML = '';
        ['S','M','T','W','T','F','S'].forEach(day => { calendar.innerHTML += `<div class="font-bold text-gray-500">${day}</div>`; });
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        for (let i = 0; i < firstDayOfMonth; i++) { calendar.innerHTML += `<div></div>`; }
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
            const log = userData.dailyLogs.find(l => l.date === dateStr);
            let bgColor = 'bg-gray-300';
            if (log) { if (log.periodCycleDay) { bgColor = 'bg-red-400'; } else if (log.completed) { bgColor = 'bg-green-500'; } }
            const border = (dateStr === getTodayDateString()) ? 'ring-2 ring-accent' : '';
            calendar.innerHTML += `<div class="day-cell"><div class="day-content rounded-md ${bgColor} ${border} text-white font-bold text-xs" title="${dateStr}">${i}</div></div>`;
        }
    }

    function initializeWaterTracker() {
        const container = document.getElementById('water-tracker');
        if (!container) return;
        container.innerHTML = '';
        const todayLog = getOrCreateTodayLog();
        const waterCount = todayLog.water || 0;
        const MINIMUM_INTAKE = 6;
        const TOTAL_INTAKE = 14;
        for (let i = 0; i < TOTAL_INTAKE; i++) {
            const droplet = document.createElement('i');
            let dropletColor;
            if (i < waterCount) { dropletColor = 'text-blue-400'; }
            else if (i < MINIMUM_INTAKE) { dropletColor = 'text-blue-200'; }
            else { dropletColor = 'text-gray-300'; }
            droplet.className = `fas fa-tint text-4xl cursor-pointer transition-colors ${dropletColor}`;
            droplet.dataset.index = i + 1;
            droplet.addEventListener('click', handleWaterClick);
            container.appendChild(droplet);
        }
    }

    const FOOD_ITEMS = [
        { id: 'egg1', name: 'Egg 1', emoji: '🥚', note: 'Protein' },
        { id: 'egg2', name: 'Egg 2', emoji: '🥚', note: 'Protein' },
        { id: 'egg3', name: 'Egg 3', emoji: '🥚', note: 'Protein' },
        { id: 'banana1', name: 'Banana 1', emoji: '🍌', note: 'Pre-workout' },
        { id: 'banana2', name: 'Banana 2', emoji: '🍌', note: 'Pre-workout' },
        { id: 'amla', name: 'Amla', emoji: '🫐', note: 'Morning' },
        { id: 'nuts', name: 'Mixed Nuts', emoji: '🥜', note: 'Magnesium' }
    ];

    function initializeFoodChecklist() {
        const container = document.getElementById('food-checklist');
        const badge = document.getElementById('food-progress-badge');
        const allDoneMsg = document.getElementById('food-all-done');
        if (!container) return;

        const todayLog = getOrCreateTodayLog();
        const completedFood = todayLog.food || [];

        container.innerHTML = FOOD_ITEMS.map(item => {
            const isChecked = completedFood.includes(item.id);
            return `
                <div class="food-item ${isChecked ? 'checked' : ''}" data-id="${item.id}">
                    <i class="fas fa-check-circle food-check"></i>
                    <span class="food-emoji">${item.emoji}</span>
                    <span class="food-name">${item.name}</span>
                    <span class="food-note">${item.note}</span>
                </div>
            `;
        }).join('');

        const doneCount = completedFood.length;
        const totalCount = FOOD_ITEMS.length;
        if (badge) badge.textContent = `${doneCount} / ${totalCount}`;
        
        if (allDoneMsg) {
            if (doneCount === totalCount) allDoneMsg.classList.remove('hidden');
            else allDoneMsg.classList.add('hidden');
        }

        container.querySelectorAll('.food-item').forEach(el => {
            el.addEventListener('click', handleFoodClick);
        });
    }

    function handleFoodClick(event) {
        const itemEl = event.currentTarget;
        const foodId = itemEl.dataset.id;
        const todayLog = getOrCreateTodayLog();
        
        if (!todayLog.food) todayLog.food = [];
        
        const index = todayLog.food.indexOf(foodId);
        if (index > -1) {
            todayLog.food.splice(index, 1);
        } else {
            todayLog.food.push(foodId);
        }
        
        api.saveLog(currentUser, todayLog);
        initializeFoodChecklist();
    }

    function showConfirmation(title, message, onConfirm) {
        document.getElementById('confirmation-title').textContent = title;
        document.getElementById('confirmation-message').textContent = message;
        document.getElementById('confirmation-modal').classList.add('active');
        confirmationCallback = onConfirm;
    }

    function handleWaterClick(event) {
        const selectedIndex = parseInt(event.target.dataset.index);
        const todayLog = getOrCreateTodayLog();
        todayLog.water = todayLog.water === selectedIndex ? selectedIndex - 1 : selectedIndex;
        api.saveLog(currentUser, todayLog);
        initializeWaterTracker();
    }

    function completeExercise() {
        const todayLog = getOrCreateTodayLog();
        todayLog.completed = true;
        api.saveLog(currentUser, todayLog);
        renderConsistencyCalendar();
        document.getElementById('today-routine-container')?.classList.add('hidden');
        document.getElementById('completion-button-container')?.classList.add('hidden');
        document.getElementById('completion-card')?.classList.remove('hidden');
    }

    async function handlePeriodDaySelection(selectedDay) {
        const today = new Date();
        for (let i = 0; i < selectedDay; i++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() - i);
            const dateStr = targetDate.toISOString().split('T')[0];
            const dayToMark = selectedDay - i;
            let log = userData.dailyLogs.find(l => l.date === dateStr);
            if (log) { log.periodCycleDay = dayToMark; }
            else { log = { date: dateStr, periodCycleDay: dayToMark, completed: false, water: 0 }; userData.dailyLogs.push(log); }
            await api.saveLog(currentUser, log);
        }
        document.getElementById('period-day-modal').classList.remove('active');
        renderTodayRoutine();
        renderConsistencyCalendar();
    }

    async function handlePeriodCycleReset() {
        const logsByDate = new Map(userData.dailyLogs.map(log => [log.date, log]));
        let currentDate = new Date();
        let currentLog = logsByDate.get(currentDate.toISOString().split('T')[0]);
        if (!currentLog || !currentLog.periodCycleDay) { alert("You are not currently in a logged period cycle."); return; }
        while (currentLog && currentLog.periodCycleDay) {
            currentLog.periodCycleDay = null;
            await api.saveLog(currentUser, currentLog);
            currentDate.setDate(currentDate.getDate() - 1);
            currentLog = logsByDate.get(currentDate.toISOString().split('T')[0]);
        }
        document.getElementById('period-day-modal').classList.remove('active');
        renderTodayRoutine();
        renderConsistencyCalendar();
        alert("The period cycle has been reset.");
    }

    // --- EVENT LISTENERS ---
    document.getElementById('confirm-btn')?.addEventListener('click', () => { if (confirmationCallback) confirmationCallback(); document.getElementById('confirmation-modal').classList.remove('active'); });
    document.getElementById('cancel-btn')?.addEventListener('click', () => { document.getElementById('confirmation-modal').classList.remove('active'); });
    document.getElementById('period-start-btn')?.addEventListener('click', () => { document.getElementById('period-day-modal').classList.add('active'); });
    document.getElementById('close-period-modal-btn')?.addEventListener('click', () => { document.getElementById('period-day-modal').classList.remove('active'); });
    document.querySelectorAll('.period-day-select-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const day = parseInt(e.target.dataset.day);
            showConfirmation(`Confirm Period Day ${day}`, "This will mark previous days and cannot be changed. Are you sure?", () => handlePeriodDaySelection(day));
        });
    });
    document.getElementById('not-period-btn')?.addEventListener('click', () => { showConfirmation("Reset Period Cycle?", "This will remove all period day entries for the current cycle. Are you sure?", handlePeriodCycleReset); });
    document.getElementById('complete-exercise-btn')?.addEventListener('click', completeExercise);
    document.getElementById('prev-month-btn')?.addEventListener('click', () => { displayedDate.setMonth(displayedDate.getMonth() - 1); renderConsistencyCalendar(); });
    document.getElementById('next-month-btn')?.addEventListener('click', () => { displayedDate.setMonth(displayedDate.getMonth() + 1); renderConsistencyCalendar(); });

    document.body.addEventListener('click', function (event) {
        const toggle = event.target.closest('.accordion-toggle');
        if (toggle) {
            const content = toggle.nextElementSibling;
            const icon = toggle.querySelector('i');
            content.classList.toggle('open');
            icon.classList.toggle('fa-chevron-down');
            icon.classList.toggle('fa-chevron-up');
        }
    });

    function loadFullRoutinePage() {
        const container = document.getElementById('routine-accordion-container');
        if (container) container.innerHTML = routineData.map((day, i) => createRoutineCard(day, i, 'routine')).join('');
        const periodContainer = document.getElementById('period-plan-accordion-container');
        if (periodContainer) periodContainer.innerHTML = periodPlanData.map((day, i) => createRoutineCard(day, i, 'period')).join('');
    }

    const sidenav = document.getElementById('sidenav');
    const sidenavOverlay = document.getElementById('sidenav-overlay');
    document.getElementById('mobile-menu-button')?.addEventListener('click', () => { sidenav.classList.add('open'); sidenavOverlay.classList.remove('hidden'); });
    sidenavOverlay?.addEventListener('click', () => { sidenav.classList.remove('open'); sidenavOverlay.classList.add('hidden'); });

    // --- LOGIN PAGE ---
    let isLoginMode = true;
    const formTitle   = document.getElementById('form-title');
    const submitBtn   = document.getElementById('submit-btn');
    const toggleText  = document.getElementById('toggle-text');
    const toggleLink  = document.getElementById('toggle-link');

    toggleLink?.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        if (isLoginMode) {
            formTitle.textContent = 'User Login'; submitBtn.textContent = 'Login';
            toggleText.textContent = "Don't have an account? "; toggleLink.textContent = 'Sign Up';
        } else {
            formTitle.textContent = 'Create Account'; submitBtn.textContent = 'Sign Up';
            toggleText.textContent = 'Already have an account? '; toggleLink.textContent = 'Login';
        }
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('username').value;
        const pass   = document.getElementById('password').value;
        let result;
        if (isLoginMode) { result = await api.login(userId, pass); }
        else { result = await api.signUp(userId, pass); }
        if (result.status === 'success') { localStorage.setItem('herCycleUser', result.userId); window.location.href = 'index.html'; }
        else { alert(result.message); }
    });

    // --- PAGE DATA LOADERS ---
    async function loadHomePageData() {
        const data = await api.getUserData(currentUser);
        userData.dailyLogs = data.dailyLogs || [];
        const todayLog = getOrCreateTodayLog();
        if (todayLog.completed) {
            document.getElementById('today-routine-container')?.classList.add('hidden');
            document.getElementById('completion-button-container')?.classList.add('hidden');
            document.getElementById('completion-card')?.classList.remove('hidden');
        }
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const yesterdayLog = userData.dailyLogs.find(l => l.date === yesterdayStr);
        if (yesterdayLog && yesterdayLog.periodCycleDay && yesterdayLog.periodCycleDay < 5) {
            const newPeriodDay = yesterdayLog.periodCycleDay + 1;
            if (!todayLog.periodCycleDay) { todayLog.periodCycleDay = newPeriodDay; api.saveLog(currentUser, todayLog); }
        }
        renderConsistencyCalendar();
        renderTodayRoutine();
        initializeWaterTracker();
        initializeFoodChecklist();
        document.getElementById('welcome-message').textContent = `Ready to conquer the day, ${currentUser}!`;
    }

    async function loadStatsPageData() {
        const data = await api.getUserData(currentUser);
        userData.dailyLogs = data.dailyLogs || [];
        renderCycleHistory();
        renderWaterIntakeChart();
    }

    function renderCycleHistory() {
        const container = document.getElementById('cycle-stats-container');
        if (!container) return;
        const periodStartLogs = userData.dailyLogs.filter(log => log.periodCycleDay === 1).sort((a, b) => new Date(b.date) - new Date(a.date));
        if (periodStartLogs.length < 1) { container.innerHTML = `<div class="bg-white p-6 rounded-lg shadow text-center"><p>No period start dates have been logged yet.</p></div>`; return; }
        let statsHtml = '';
        for (let i = periodStartLogs.length - 1; i >= 0; i--) {
            const startDate = new Date(periodStartLogs[i].date);
            const formattedDate = startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
            let cycleLengthHtml = '<p class="text-gray-500 text-sm mt-1">First cycle logged.</p>';
            if (i < periodStartLogs.length - 1) {
                const nextStartDate = new Date(periodStartLogs[i+1].date);
                const cycleLength = (nextStartDate - startDate) / (1000 * 60 * 60 * 24);
                cycleLengthHtml = `<p class="font-semibold mt-1">Cycle Length: <span class="text-accent">${cycleLength} days</span></p>`;
            }
            statsHtml = `<div class="bg-white p-4 rounded-lg shadow-md flex items-center space-x-4"><div class="bg-secondary p-3 rounded-full"><i class="fas fa-calendar-alt text-accent text-xl"></i></div><div><p class="font-bold">Period Started: ${formattedDate}</p>${cycleLengthHtml}</div></div>` + statsHtml;
        }
        container.innerHTML = statsHtml;
    }

    function renderWaterIntakeChart() {
        if (!userData || !userData.dailyLogs) return;
        const titleEl  = document.getElementById('progress-chart-title');
        const statsEl  = document.getElementById('stats-container');
        const canvasEl = document.getElementById('waterIntakeChart');
        if (!titleEl || !statsEl || !canvasEl) return;
        titleEl.textContent = progressDisplayedDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        const month = progressDisplayedDate.getMonth();
        const year  = progressDisplayedDate.getFullYear();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthlyLogs = userData.dailyLogs.filter(log => {
            const logDate = new Date(log.date);
            const userDate = new Date(Date.UTC(logDate.getFullYear(), logDate.getMonth(), logDate.getDate()));
            return userDate.getUTCFullYear() === year && userDate.getUTCMonth() === month;
        });
        const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const dataPoints = Array(daysInMonth).fill(null);
        let pointBackgroundColors = Array(daysInMonth).fill('rgba(129, 178, 154, 0.8)');
        let totalWater = 0, loggedDays = 0, lowestIntake = 14;
        monthlyLogs.forEach(log => {
            const dayOfMonth = new Date(log.date).getUTCDate();
            const water = log.water || 0;
            dataPoints[dayOfMonth - 1] = water;
            totalWater += water;
            if (water > 0) loggedDays++;
            if (water < lowestIntake) lowestIntake = water;
        });
        for (let i = 0; i < dataPoints.length; i++) { if (dataPoints[i] === lowestIntake && loggedDays > 0) { pointBackgroundColors[i] = 'rgba(224, 122, 95, 1)'; } }
        const avgGlasses = loggedDays > 0 ? (totalWater / loggedDays) : 0;
        const avgLiters  = (avgGlasses * 0.25).toFixed(1);
        statsEl.innerHTML = `<div class="bg-secondary p-4 rounded-lg"><p class="text-gray-600">Avg. Daily Intake</p><p class="font-bold text-2xl text-accent">${avgLiters} L</p></div><div class="bg-secondary p-4 rounded-lg"><p class="text-gray-600">Lowest Intake</p><p class="font-bold text-2xl text-red-500">${loggedDays > 0 ? lowestIntake : 'N/A'} glasses</p></div>`;
        if (waterChartInstance) { waterChartInstance.destroy(); }
        waterChartInstance = new Chart(canvasEl, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Glasses of Water', data: dataPoints, borderColor: 'rgba(129, 178, 154, 1)', backgroundColor: pointBackgroundColors, fill: false, tension: 0.2, spanGaps: true }] },
            options: { scales: { y: { beginAtZero: true, max: 14 } }, plugins: { legend: { display: false } } }
        });
    }

    document.getElementById('prev-month-btn-progress')?.addEventListener('click', () => { progressDisplayedDate.setMonth(progressDisplayedDate.getMonth() - 1); renderWaterIntakeChart(); });
    document.getElementById('next-month-btn-progress')?.addEventListener('click', () => { progressDisplayedDate.setMonth(progressDisplayedDate.getMonth() + 1); renderWaterIntakeChart(); });

    // --- BOOT ---
    checkAuth();
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if      (currentPage.includes('index.html'))   { loadHomePageData(); }
    else if (currentPage.includes('stats.html'))   { loadStatsPageData(); }
    else if (currentPage.includes('routine.html')) { loadFullRoutinePage(); }
});