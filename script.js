document.addEventListener('DOMContentLoaded', () => {
    // --- LIVE BACKEND API ---
    const googleScriptUrl = 'https://script.google.com/macros/s/AKfycbwAXwtj3cjByPdhY3XfawwPRtENVamfi-EUcSW5ZAEjyLkAR1z0Y-AzksWaXAZ4N7b3/exec';

    // --- VOICE & ROUTINE STATE ---
    const synth = window.speechSynthesis;
    let isRoutineActive = false;
    let stopRoutineFlag = false;
    let selectedVoice = null;

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

            utterance.onend = () => {
                const duration = Date.now() - startTime;
                resolve(duration);
            };
            
            utterance.onerror = () => {
                resolve(0); 
            };

            synth.speak(utterance);
        });
    }

    function delay(ms) {
        return new Promise(resolve => {
            if (stopRoutineFlag) { resolve(); return; }
            setTimeout(resolve, ms);
        });
    }

    // --- INTERVAL COUNTDOWN UTILITY (5s Intervals) ---
    function runIntervalCount(totalSeconds, rate = 1.1) {
        return new Promise((resolve) => {
            if (stopRoutineFlag) { resolve(); return; }
            
            let current = 0;
            const intervalStep = 1000; // Check every second
            
            const timer = setInterval(() => {
                if (stopRoutineFlag) {
                    clearInterval(timer);
                    resolve();
                    return;
                }
                
                current++;
                
                // Speak only on multiples of 5 (5, 10, 15...) OR the final second if not a multiple
                if (current % 5 === 0) {
                    synth.cancel(); 
                    const utterance = new SpeechSynthesisUtterance(String(current));
                    utterance.voice = selectedVoice;
                    utterance.rate = rate;
                    synth.speak(utterance);
                }

                if (current >= totalSeconds) {
                    clearInterval(timer);
                    // Ensure we wait for the last "20" or "30" to be spoken if it was just triggered
                    setTimeout(resolve, 1000); 
                }
            }, intervalStep);
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

    // --- SMART EXERCISE CUES ---
    function getInstructionCues(exerciseName) {
        const name = exerciseName.toLowerCase();
        if (name.includes('squat')) return { up: "Lower down slowly...", down: "And... Up." };
        if (name.includes('bridge') || name.includes('lift')) return { up: "Lift your hips high...", down: "Lower to the floor." };
        if (name.includes('lunge')) return { up: "Step forward...", down: "Push back." };
        if (name.includes('twist')) return { up: "Gentle twist...", down: "Return to center." };
        if (name.includes('tilt')) return { up: "Tilt pelvis up...", down: "Release." };
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

    // --- CORE ROUTINE RUNNER ---
    async function runFullRoutine(exercises, buttonId, contextId = 'today-routine') {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const originalText = btn.innerHTML;
        const originalClasses = btn.className;

        btn.innerHTML = '<i class="fas fa-stop mr-2"></i>Stop Routine';
        btn.classList.remove('bg-accent', 'text-accent', 'bg-white');
        btn.classList.add('bg-red-500', 'text-white', 'pulse-red');
        
        isRoutineActive = true;
        stopRoutineFlag = false;
        
        if (!selectedVoice) loadVoices();

        const activeExercises = exercises.map((ex, i) => ({...ex, originalIndex: i}))
                                         .filter(ex => !ex.name.toLowerCase().includes('walk'));

        await speak("Let's begin your practice. Find a comfortable space.", 0.9);
        await delay(1000);

        for (let i = 0; i < activeExercises.length; i++) {
            if (stopRoutineFlag) break;

            const exercise = activeExercises[i];
            const originalIndex = exercise.originalIndex;
            
            highlightExercise(originalIndex, true, contextId);

            // 1. Announce Exercise with calm intro
            await speak(`Next movement... ${exercise.name}`, 0.9);
            await delay(2000); 
            
            // Parse Data
            const sets = parseToNumber(exercise.sets) || 1;
            const reps = parseToNumber(exercise.reps);
            const holdSec = parseSeconds(exercise.hold);
            const restSec = parseSeconds(exercise.rest);
            const cues = getInstructionCues(exercise.name);

            const isCatCow = exercise.name.toLowerCase().includes('cat');
            const isRepAndHold = (reps > 1 && holdSec > 0); 
            const isStaticHold = (holdSec > 0 && reps <= 1);
            const isStandardRep = (reps > 0 && holdSec === 0);

            // 2. Loop Sets
            for (let currentSet = 1; currentSet <= sets; currentSet++) {
                if (stopRoutineFlag) break;

                if (sets > 1) await speak(`Set ${currentSet}`, 0.9);
                
                // --- A. SPECIAL LOGIC: CAT-COW ---
                if (isCatCow) {
                    await speak("Come to all fours. Hands under shoulders.", 0.9);
                    await delay(3000); 
                    
                    const catCowRounds = reps > 0 ? reps : 10; 
                    
                    for (let r = 1; r <= catCowRounds; r++) {
                        if (stopRoutineFlag) break;
                        await speak("Inhale... Drop your belly... Look up.", 0.85);
                        await delay(3500); 

                        await speak("Exhale... Round your spine... Chin to chest.", 0.85);
                        await delay(3500); 
                    }
                } 
                
                // --- B. REPS WITH HOLD (Dynamic Holds) ---
                else if (isRepAndHold) {
                    await speak("Get ready... Begin.", 0.9);
                    await delay(1000);
                    
                    for (let r = 1; r <= reps; r++) {
                        if (stopRoutineFlag) break;
                        
                        await speak(`${cues.up}... and Hold.`, 1.0);
                        
                        // Use Interval Timer (5s chunks) for hold
                        // If hold is short (e.g. 2s), runIntervalCount handles it by finishing
                        await runIntervalCount(holdSec, 1.2);
                        
                        await speak(cues.down, 1.0);
                        await delay(2000); 
                    }
                }

                // --- C. STATIC HOLD (Plank, Stretches - 5s Intervals) ---
                else if (isStaticHold) {
                    await speak("Move into position... Lift... and Hold.", 0.9);
                    await delay(1000);
                    
                    // Count 5, 10, 15...
                    await runIntervalCount(holdSec, 1.2);
                    
                    await speak("Gently release.", 0.9);
                }

                // --- D. STANDARD REPS (Squats - 3s Window) ---
                else if (isStandardRep) {
                    await speak("Prepare... Go.", 0.9);
                    await delay(1000);

                    for (let r = 1; r <= reps; r++) {
                        if (stopRoutineFlag) break;
                        
                        // Phase 1: Down (1.5s approx)
                        await speak(cues.up, 1.0); 
                        await delay(1500); 
                        
                        // Phase 2: Up (1.5s approx) -> Total ~3s per rep
                        await speak(`${cues.down} ${r}`, 1.0);
                        await delay(1500); 
                    }
                }

                // 3. REST COUNTING (Standard 1... End for short rests)
                const isLastExercise = (i === activeExercises.length - 1);
                const isLastSet = (currentSet === sets);

                if (restSec > 0 && !(isLastExercise && isLastSet)) {
                    await speak("Rest... Breathe deeply.", 0.9);
                    
                    // Simple countdown for rest is usually fine, but let's stick to 5s intervals if it's long (>10s)
                    // otherwise count every second for short rests to keep you engaged
                    if (restSec > 10) {
                         await runIntervalCount(restSec, 1.2);
                    } else {
                        // Short rest: count normally
                        for (let r = 1; r <= restSec; r++) {
                            if (stopRoutineFlag) break;
                            await speak(String(r), 1.2);
                            await delay(800);
                        }
                    }
                }
            }

            highlightExercise(originalIndex, false, contextId);
            
            if (i < activeExercises.length - 1 && !stopRoutineFlag) {
                await delay(1500); 
            }
        }

        if(!stopRoutineFlag) {
            await speak("Namaste. Great practice today.", 0.9);
        }
        
        resetRoutineUI(btn, originalText, originalClasses);
    }

    function resetRoutineUI(btn, text, classes) {
        stopRoutineFlag = true;
        isRoutineActive = false;
        synth.cancel();
        if(btn) {
            btn.innerHTML = text;
            btn.className = classes;
        }
        document.querySelectorAll('.active-exercise-card').forEach(el => el.classList.remove('active-exercise-card'));
    }

    window.handleGlobalStop = function() {
        stopRoutineFlag = true;
        isRoutineActive = false;
        synth.cancel();
        document.querySelectorAll('.active-exercise-card').forEach(el => el.classList.remove('active-exercise-card'));
    }

    // --- API & DATA HANDLING ---
    const api = {
        login: async (userId, password) => {
            const response = await fetch(`${googleScriptUrl}?action=login&userId=${userId}&password=${password}`);
            return response.json();
        },
        signUp: async (userId, password) => {
             const response = await fetch(googleScriptUrl, {
                method: 'POST',
                mode: 'no-cors', 
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ action: 'signUp', userId: userId, password: password })
            });
            return await api.login(userId, password);
        },
        getUserData: async (userId) => {
            console.log(`FETCHING data for ${userId}...`);
            const response = await fetch(`${googleScriptUrl}?action=getUserData&userId=${userId}`);
            return response.json();
        },
        saveLog: async (userId, logData) => {
            console.log(`SAVING log for date: ${logData.date}`);
            const response = await fetch(googleScriptUrl, {
                method: 'POST',
                mode: 'no-cors', 
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ action: 'saveLog', userId: userId, logData: logData })
            });
            return { success: true };
        }
    };

    const imageMap = { 'Cat–Cow Pose': { gif: 'images/cat_cow.gif', jpg: ['images/cat_cow.jpg'] }, 'Child’s Pose': { gif: "images/child's pose.gif", jpg: ['images/child.jpg', 'images/child_1.jpg'] }, 'Bridge Pose': { gif: 'images/bridge.gif', jpg: ['images/bridge.jpg', 'images/bridge_1.jpg'] }, 'Seated Forward Bend': { gif: 'images/Seated Forward Bend.gif', jpg: ['images/Seated Forward Bend.jpg', 'images/Seated Forward Bend_1.jpg'] }, 'Bodyweight Squats': { gif: 'images/Squats.gif', jpg: ['images/Squats.jpg', 'images/Squats_1.jpg'] }, 'Forward Lunges': { gif: 'images/Lunges.gif', jpg: ['images/Lunges.jpg'] }, 'Glute Bridge': { gif: 'images/Glute Bridges.gif', jpg: ['images/Glute Bridges.jpg'] }, 'Butterfly Stretch': { gif: null, jpg: ['images/Butterfly Stretch.jpg'] }, 'Pelvic Tilts': { gif: 'images/pelvic_tilt.gif', jpg: [] }, 'Cobra Pose': { gif: 'images/Cobra-Pose.gif', jpg: ['images/Cobra Pose.webp'] }, 'Reclined Twist': { gif: 'images/reclined twist.gif', jpg: ['images/Reclined Twist.jpg'] }, 'Plank': { gif: null, jpg: ['images/Plank.jpg'] }, 'Brisk Walk / Light Dance': { gif: null, jpg: ['images/walking.jpg'] },'Warm-up Walk': { gif: null, jpg: ['images/walking.jpg'] }, 'Gentle Yoga / Slow Walk': { gif: null, jpg: ['images/walking.jpg'] }, 'Walking / Zumba / Cycling / Dancing': { gif: null, jpg: ['images/walking.jpg'] }, 'Deep Breathing': { gif: null, jpg: ['images/breathing.jpg'] }, 'Deep Belly Breathing': { gif: null, jpg: ['images/breathing.jpg'] }, 'Meditation / Mindful Breathing': { gif: null, jpg: ['images/breathing.jpg'] }};
    
    // Data Arrays
    const routineData = [ { day: 'Monday', title: 'Gentle Full-Body Flow', goal: 'Relax lower back & abdomen.', exercises: [ { name: 'Brisk Walk / Light Dance', sets: '-', reps: '-', hold: '5 min', rest: '-', instructions: 'Start your session with a light warm-up.' }, { name: 'Cat–Cow Pose', sets: '1', reps: '10 rounds', hold: '~1 min total', rest: '10 sec', instructions: 'Move with your breath.' }, { name: 'Child’s Pose', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Fold forward.' }, { name: 'Bridge Pose', sets: '2', reps: '1', hold: '20 sec', rest: '20 sec', instructions: 'Lift hips.' }, { name: 'Seated Forward Bend', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Hinge forward.' }, { name: 'Deep Breathing', sets: '1', reps: '-', hold: '2 min', rest: '-', instructions: 'Inhale slowly.' }, ] }, { day: 'Tuesday', title: 'Lower-Body Strength', goal: 'Strengthen pelvic & leg muscles.', exercises: [ { name: 'Warm-up Walk', sets: '-', reps: '-', hold: '5 min', rest: '-', instructions: 'Begin with a walk.' }, { name: 'Bodyweight Squats', sets: '2', reps: '10', hold: '-', rest: '30 sec', instructions: 'Lower hips.' }, { name: 'Forward Lunges', sets: '2', reps: '10', hold: '-', rest: '30 sec', instructions: 'Step forward.' }, { name: 'Glute Bridge', sets: '2', reps: '15', hold: '2 sec', rest: '30 sec', instructions: 'Squeeze glutes.' }, { name: 'Butterfly Stretch', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Feet together.' }, { name: 'Deep Breathing', sets: '1', reps: '-', hold: '2 min', rest: '-', instructions: 'Relax.' }, ] }, { day: 'Wednesday', title: 'Core & Stretch', goal: 'Ease cramps & improve flexibility.', exercises: [ { name: 'Pelvic Tilts', sets: '1', reps: '10', hold: '2 sec', rest: '10 sec', instructions: 'Tilt pelvis.' }, { name: 'Cobra Pose', sets: '2', reps: '1', hold: '30 sec', rest: '15 sec', instructions: 'Lift chest.' }, { name: 'Bridge Pose', sets: '2', reps: '1', hold: '20 sec', rest: '20 sec', instructions: 'Strengthen back.' }, { name: 'Seated Forward Bend', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Focus on stretch.' }, { name: 'Child’s Pose', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Relaxation.' }, { name: 'Deep Breathing', sets: '1', reps: '-', hold: '2 min', rest: '-', instructions: 'Calm body.' }, ] }, { day: 'Thursday', title: 'Yoga for Periods', goal: 'Calm the body, reduce cramps & fatigue.', exercises: [ { name: 'Cat–Cow Pose', sets: '1', reps: '10 rounds', hold: '~1 min', rest: '10 sec', instructions: 'Spinal flow.' }, { name: 'Child’s Pose', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Ease tension.' }, { name: 'Reclined Twist', sets: '1', reps: '1', hold: '1 min', rest: '10 sec', instructions: 'Twist gently.' }, { name: 'Bridge Pose', sets: '1', reps: '1', hold: '1 min', rest: '20 sec', instructions: 'Open chest.' }, { name: 'Deep Belly Breathing', sets: '1', reps: '-', hold: '3 min', rest: '-', instructions: 'Calm system.' }, ] }, { day: 'Friday', title: 'Core & Posture', goal: 'Improve core strength & blood flow.', exercises: [ { name: 'Plank', sets: '2', reps: '1', hold: '20 sec', rest: '30 sec', instructions: 'Hold straight.' }, { name: 'Pelvic Tilts', sets: '1', reps: '10', hold: '2 sec', rest: '15 sec', instructions: 'Engage core.' }, { name: 'Bridge Pose', sets: '2', reps: '1', hold: '20 sec', rest: '20 sec', instructions: 'Posture.' }, { name: 'Seated Forward Bend', sets: '1', reps: '1', hold: '2 min', rest: '15 sec', instructions: 'Loosen back.' }, { name: 'Deep Breathing', sets: '1', reps: '-', hold: '2 min', rest: '-', instructions: 'Recover.' }, ] }, { day: 'Saturday', title: 'Stretch + Relax', goal: 'Relax muscles & calm mind.', exercises: [ { name: 'Gentle Yoga / Slow Walk', sets: '-', reps: '-', hold: '10 min', rest: '-', instructions: 'Light movement.' }, { name: 'Meditation / Mindful Breathing', sets: '-', reps: '-', hold: '5 min', rest: '-', instructions: 'Focus on breath.' }, { name: 'Light Abdomen Massage (optional)', sets: '-', reps: '-', hold: '2–3 min', rest: '-', instructions: 'Gentle motions.' }, ] }, { day: 'Sunday', title: 'Active Cardio', goal: 'Boost endorphins, reduce stress.', exercises: [ { name: 'Walking / Zumba / Cycling / Dancing', sets: '-', reps: '-', hold: '20 min', rest: 'As needed', instructions: 'Moderate intensity.' }, { name: 'Leg & Back Stretch', sets: '-', reps: '-', hold: '5 min', rest: '-', instructions: 'Cool down.' }, ] }, ];
    const periodPlanData = [ { day: 'Day 1', title: 'Rest & Gentle Flow', goal: 'Eases first-day cramps, calms body', exercises: [ { name: 'Child’s Pose', hold: '3 min', instructions: 'Relax lower back.' }, { name: 'Cat–Cow Pose', hold: '1 min', instructions: 'Massage spine.' }, { name: 'Deep Belly Breathing', hold: '5 min', instructions: 'Deep breaths.' }, ] }, { day: 'Day 2', title: 'Gentle Yoga Stretch', goal: 'Reduces lower-back pain & flow discomfort', exercises: [ { name: 'Cat–Cow Pose', hold: '2 min', instructions: 'Slow movements.' }, { name: 'Reclined Twist', hold: '1 min each side', instructions: 'Gentle twist.' }, { name: 'Bridge Pose', sets: '2', hold: '20 sec', instructions: 'Gentle bridge.' }, ] }, { day: 'Day 3', title: 'Relax & Breathe', goal: 'Relaxes uterus & relieves stress', exercises: [ { name: 'Child’s Pose', hold: '2 min', instructions: 'Restorative.' }, { name: 'Seated Forward Bend', hold: '2 min', instructions: 'Stretch hamstrings.' }, { name: 'Deep Breathing / Meditation', hold: '5 min', instructions: 'Mental relaxation.' }, ] }, { day: 'Day 4', title: 'Light Movement', goal: 'Improves blood circulation & eases bloating', exercises: [ { name: 'Cat–Cow Pose', hold: '1 min', instructions: 'Quick flow.' }, { name: 'Bridge Pose', sets: '2', hold: '20 sec', instructions: 'Gentle strengthening.' }, { name: 'Pelvic Tilts', reps: '10', instructions: 'Improve flow.' }, ] }, { day: 'Day 5', title: 'Restore & Stretch', goal: 'Final relaxation before energy returns', exercises: [ { name: 'Reclined Twist', hold: '1 min each side', instructions: 'Release tension.' }, { name: 'Child’s Pose', hold: '2 min', instructions: 'Final restorative.' }, { name: 'Butterfly Stretch', hold: '2 min', instructions: 'Open hips.' }, { name: 'Deep Breathing', hold: '5 min', instructions: 'Feel refreshed.' }, ] } ];

    let currentUser = localStorage.getItem('herCycleUser');
    let displayedDate = new Date();
    let confirmationCallback = null;
    let userData = { dailyLogs: [] };
    let waterChartInstance = null;
    let progressDisplayedDate = new Date();

    const getTodayDateString = () => new Date().toISOString().split('T')[0];
    function checkAuth() { if (!currentUser && !window.location.pathname.endsWith('login.html')) { window.location.href = 'login.html'; } else if (currentUser) { const usernameDisplay = document.getElementById('username-display'); if (usernameDisplay) usernameDisplay.textContent = `Hi, ${currentUser}!`; } }

    function getOrCreateTodayLog() { const todayStr = getTodayDateString(); let todayLog = userData.dailyLogs.find(log => log.date === todayStr); if (!todayLog) { todayLog = { date: todayStr, water: 0, completed: false, periodCycleDay: null }; userData.dailyLogs.push(todayLog); } return todayLog; }
    
    function createExerciseHTML(exercise, index, contextId = 'today-routine') { 
        const { name, sets, reps, hold, rest, instructions } = exercise; 
        const formattedInstructions = (instructions || '').replace(/\n/g, '<br>'); 
        let galleryHtml = ''; 
        const images = imageMap[name.trim()]; 
        
        if (images) { 
            if (images.gif) { galleryHtml += `<img src="${images.gif}" alt="${name} animation" class="w-full h-48 object-contain rounded-lg mb-2 bg-white">`; } 
            if (images.jpg) { images.jpg.forEach(src => { galleryHtml += `<img src="${src}" alt="${name} illustration" class="w-full h-48 object-contain rounded-lg mb-2 bg-white">`; }); } 
        } 
        if (galleryHtml === '') { galleryHtml = `<div class="w-full h-48 bg-white rounded-lg flex items-center justify-center"><i class="fas fa-image text-4xl text-gray-300"></i></div>`; } 
        
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
        let routineSource = periodDay ? periodPlanData : routineData; 
        let routine; 
        if (periodDay && periodDay > 0 && periodDay <= periodPlanData.length) { 
            routine = routineSource[periodDay - 1]; 
        } else { 
            const dayOfWeek = new Date().getDay(); 
            const routineIndex = (dayOfWeek === 0 ? 6 : dayOfWeek - 1); 
            routine = routineSource[routineIndex]; 
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

    window.handleRoutinePageStart = function(btnId, encodedExercises, contextId) {
        if (isRoutineActive) {
            handleGlobalStop();
        } else {
            const exercises = JSON.parse(decodeURIComponent(encodedExercises));
            runFullRoutine(exercises, btnId, contextId);
        }
    };

    function renderConsistencyCalendar() { const calendar = document.getElementById('consistency-calendar'); const title = document.getElementById('calendar-title'); if (!calendar || !title) return; const month = displayedDate.getMonth(); const year = displayedDate.getFullYear(); title.textContent = `${displayedDate.toLocaleString('default', { month: 'long' })} ${year}`; calendar.innerHTML = ''; ['S','M','T','W','T','F','S'].forEach(day => { calendar.innerHTML += `<div class="font-bold text-gray-500">${day}</div>`; }); const daysInMonth = new Date(year, month + 1, 0).getDate(); const firstDayOfMonth = new Date(year, month, 1).getDay(); for(let i=0; i < firstDayOfMonth; i++) { calendar.innerHTML += `<div></div>`; } for(let i=1; i<=daysInMonth; i++) { const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`; const log = userData.dailyLogs.find(l => l.date === dateStr); let bgColor = 'bg-gray-300'; if (log) { if (log.periodCycleDay) { bgColor = 'bg-red-400'; } else if (log.completed) { bgColor = 'bg-green-500'; } } let border = (dateStr === getTodayDateString()) ? 'ring-2 ring-accent' : ''; calendar.innerHTML += `<div class="day-cell"><div class="day-content rounded-md ${bgColor} ${border} text-white font-bold text-xs" title="${dateStr}">${i}</div></div>`; } }
    function initializeWaterTracker() { const container = document.getElementById('water-tracker'); if (!container) return; container.innerHTML = ''; const todayLog = getOrCreateTodayLog(); const waterCount = todayLog.water || 0; const MINIMUM_INTAKE = 6; const TOTAL_INTAKE = 14; for (let i = 0; i < TOTAL_INTAKE; i++) { const droplet = document.createElement('i'); let dropletColor; if (i < waterCount) { dropletColor = 'text-blue-400'; } else if (i < MINIMUM_INTAKE) { dropletColor = 'text-blue-200'; } else { dropletColor = 'text-gray-300'; } droplet.className = `fas fa-tint text-4xl cursor-pointer transition-colors ${dropletColor}`; droplet.dataset.index = i + 1; droplet.addEventListener('click', handleWaterClick); container.appendChild(droplet); } }

    function showConfirmation(title, message, onConfirm) { document.getElementById('confirmation-title').textContent = title; document.getElementById('confirmation-message').textContent = message; document.getElementById('confirmation-modal').classList.add('active'); confirmationCallback = onConfirm; }
    
    function handleWaterClick(event) { const selectedIndex = parseInt(event.target.dataset.index); const todayLog = getOrCreateTodayLog(); todayLog.water = todayLog.water === selectedIndex ? selectedIndex - 1 : selectedIndex; api.saveLog(currentUser, todayLog); initializeWaterTracker(); }
    function completeExercise() { const todayLog = getOrCreateTodayLog(); todayLog.completed = true; api.saveLog(currentUser, todayLog); renderConsistencyCalendar(); document.getElementById('today-routine-container')?.classList.add('hidden'); document.getElementById('completion-button-container')?.classList.add('hidden'); document.getElementById('completion-card')?.classList.remove('hidden'); }
    async function handlePeriodDaySelection(selectedDay) { const today = new Date(); for (let i = 0; i < selectedDay; i++) { const targetDate = new Date(today); targetDate.setDate(today.getDate() - i); const dateStr = targetDate.toISOString().split('T')[0]; const dayToMark = selectedDay - i; let log = userData.dailyLogs.find(l => l.date === dateStr); if (log) { log.periodCycleDay = dayToMark; } else { log = { date: dateStr, periodCycleDay: dayToMark, completed: false, water: 0 }; userData.dailyLogs.push(log); } await api.saveLog(currentUser, log); } document.getElementById('period-day-modal').classList.remove('active'); renderTodayRoutine(); renderConsistencyCalendar(); }
    async function handlePeriodCycleReset() { const logsByDate = new Map(userData.dailyLogs.map(log => [log.date, log])); let currentDate = new Date(); let currentLog = logsByDate.get(currentDate.toISOString().split('T')[0]); if (!currentLog || !currentLog.periodCycleDay) { alert("You are not currently in a logged period cycle."); return; } while (currentLog && currentLog.periodCycleDay) { currentLog.periodCycleDay = null; await api.saveLog(currentUser, currentLog); currentDate.setDate(currentDate.getDate() - 1); currentLog = logsByDate.get(currentDate.toISOString().split('T')[0]); } document.getElementById('period-day-modal').classList.remove('active'); renderTodayRoutine(); renderConsistencyCalendar(); alert("The period cycle has been reset."); }
    
    document.getElementById('confirm-btn')?.addEventListener('click', () => { if (confirmationCallback) confirmationCallback(); document.getElementById('confirmation-modal').classList.remove('active'); });
    document.getElementById('cancel-btn')?.addEventListener('click', () => { document.getElementById('confirmation-modal').classList.remove('active'); });
    document.getElementById('period-start-btn')?.addEventListener('click', () => { document.getElementById('period-day-modal').classList.add('active'); });
    document.getElementById('close-period-modal-btn')?.addEventListener('click', () => { document.getElementById('period-day-modal').classList.remove('active'); });
    document.querySelectorAll('.period-day-select-btn').forEach(button => { button.addEventListener('click', (e) => { const day = parseInt(e.target.dataset.day); showConfirmation( `Confirm Period Day ${day}`, "This will mark previous days and cannot be changed. Are you sure?", () => handlePeriodDaySelection(day) ); }); });
    document.getElementById('not-period-btn')?.addEventListener('click', () => { showConfirmation( "Reset Period Cycle?", "This will remove all period day entries for the current cycle. Are you sure?", handlePeriodCycleReset); });
    document.getElementById('complete-exercise-btn')?.addEventListener('click', completeExercise);
    document.getElementById('prev-month-btn')?.addEventListener('click', () => { displayedDate.setMonth(displayedDate.getMonth() - 1); renderConsistencyCalendar(); });
    document.getElementById('next-month-btn')?.addEventListener('click', () => { displayedDate.setMonth(displayedDate.getMonth() + 1); renderConsistencyCalendar(); });
    
    document.body.addEventListener('click', function(event) { 
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
        function renderFullRoutine() { const container = document.getElementById('routine-accordion-container'); if (container) container.innerHTML = routineData.map((day, i) => createRoutineCard(day, i, 'routine')).join(''); } 
        function renderPeriodPlan() { const container = document.getElementById('period-plan-accordion-container'); if (container) container.innerHTML = periodPlanData.map((day, i) => createRoutineCard(day, i, 'period')).join(''); } 
        renderFullRoutine(); 
        renderPeriodPlan(); 
    }

    const sidenav = document.getElementById('sidenav');
    const sidenavOverlay = document.getElementById('sidenav-overlay');
    document.getElementById('mobile-menu-button')?.addEventListener('click', () => { sidenav.classList.add('open'); sidenavOverlay.classList.remove('hidden'); });
    sidenavOverlay?.addEventListener('click', () => { sidenav.classList.remove('open'); sidenavOverlay.classList.add('hidden'); });

    let isLoginMode = true;
    const formTitle = document.getElementById('form-title');
    const submitBtn = document.getElementById('submit-btn');
    const toggleText = document.getElementById('toggle-text');
    const toggleLink = document.getElementById('toggle-link');

    toggleLink?.addEventListener('click', (e) => { e.preventDefault(); isLoginMode = !isLoginMode; if (isLoginMode) { formTitle.textContent = 'User Login'; submitBtn.textContent = 'Login'; toggleText.textContent = "Don't have an account? "; toggleLink.textContent = 'Sign Up'; } else { formTitle.textContent = 'Create Account'; submitBtn.textContent = 'Sign Up'; toggleText.textContent = 'Already have an account? '; toggleLink.textContent = 'Login'; } });
    document.getElementById('login-form')?.addEventListener('submit', async (e) => { e.preventDefault(); const userId = document.getElementById('username').value; const pass = document.getElementById('password').value; let result; if (isLoginMode) { result = await api.login(userId, pass); } else { result = await api.signUp(userId, pass); } if (result.status === 'success') { localStorage.setItem('herCycleUser', result.userId); window.location.href = 'index.html'; } else { alert(result.message); } });

    async function loadHomePageData() { const data = await api.getUserData(currentUser); userData.dailyLogs = data.dailyLogs || []; const todayLog = getOrCreateTodayLog(); if(todayLog.completed) { document.getElementById('today-routine-container')?.classList.add('hidden'); document.getElementById('completion-button-container')?.classList.add('hidden'); document.getElementById('completion-card')?.classList.remove('hidden'); } const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); const yesterdayStr = yesterday.toISOString().split('T')[0]; const yesterdayLog = userData.dailyLogs.find(l => l.date === yesterdayStr); if (yesterdayLog && yesterdayLog.periodCycleDay && yesterdayLog.periodCycleDay < 5) { const newPeriodDay = yesterdayLog.periodCycleDay + 1; if (!todayLog.periodCycleDay) { todayLog.periodCycleDay = newPeriodDay; api.saveLog(currentUser, todayLog); } } renderConsistencyCalendar(); renderTodayRoutine(); initializeWaterTracker(); document.getElementById('welcome-message').textContent = `Ready to conquer the day, ${currentUser}!`; }
    async function loadStatsPageData() { const data = await api.getUserData(currentUser); userData.dailyLogs = data.dailyLogs || []; renderCycleHistory(); renderWaterIntakeChart(); }
    
    function renderCycleHistory() { const container = document.getElementById('cycle-stats-container'); if (!container) return; const periodStartLogs = userData.dailyLogs.filter(log => log.periodCycleDay === 1).sort((a, b) => new Date(b.date) - new Date(a.date)); if (periodStartLogs.length < 1) { container.innerHTML = `<div class="bg-white p-6 rounded-lg shadow text-center"><p>No period start dates have been logged yet.</p></div>`; return; } let statsHtml = ''; for (let i = periodStartLogs.length - 1; i >= 0; i--) { const startDate = new Date(periodStartLogs[i].date); const formattedDate = startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); let cycleLengthHtml = '<p class="text-gray-500 text-sm mt-1">First cycle logged.</p>'; if (i < periodStartLogs.length - 1) { const nextStartDate = new Date(periodStartLogs[i+1].date); const cycleLength = (nextStartDate - startDate) / (1000 * 60 * 60 * 24); cycleLengthHtml = `<p class="font-semibold mt-1">Cycle Length: <span class="text-accent">${cycleLength} days</span></p>`; } statsHtml = `<div class="bg-white p-4 rounded-lg shadow-md flex items-center space-x-4"><div class="bg-secondary p-3 rounded-full"><i class="fas fa-calendar-alt text-accent text-xl"></i></div><div><p class="font-bold">Period Started: ${formattedDate}</p>${cycleLengthHtml}</div></div>` + statsHtml; } container.innerHTML = statsHtml; }
    function renderWaterIntakeChart() { if (!userData || !userData.dailyLogs) return; const titleEl = document.getElementById('progress-chart-title'); const statsEl = document.getElementById('stats-container'); const canvasEl = document.getElementById('waterIntakeChart'); if (!titleEl || !statsEl || !canvasEl) return; titleEl.textContent = progressDisplayedDate.toLocaleString('default', { month: 'long', year: 'numeric' }); const month = progressDisplayedDate.getMonth(); const year = progressDisplayedDate.getFullYear(); const daysInMonth = new Date(year, month + 1, 0).getDate(); const monthlyLogs = userData.dailyLogs.filter(log => { const logDate = new Date(log.date); const userDate = new Date(Date.UTC(logDate.getFullYear(), logDate.getMonth(), logDate.getDate())); return userDate.getUTCFullYear() === year && userDate.getUTCMonth() === month; }); const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1); const dataPoints = Array(daysInMonth).fill(null); let pointBackgroundColors = Array(daysInMonth).fill('rgba(54, 162, 235, 0.6)'); let totalWater = 0; let loggedDays = 0; let lowestIntake = 14; monthlyLogs.forEach(log => { const dayOfMonth = new Date(log.date).getUTCDate(); const water = log.water || 0; dataPoints[dayOfMonth - 1] = water; totalWater += water; if (water > 0) loggedDays++; if (water < lowestIntake) lowestIntake = water; }); for(let i = 0; i < dataPoints.length; i++) { if (dataPoints[i] === lowestIntake && loggedDays > 0) { pointBackgroundColors[i] = 'rgba(255, 99, 132, 1)'; } } const avgGlasses = loggedDays > 0 ? (totalWater / loggedDays) : 0; const avgLiters = (avgGlasses * 0.25).toFixed(1); statsEl.innerHTML = `<div class="bg-secondary p-4 rounded-lg"><p class="text-gray-600">Avg. Daily Intake</p><p class="font-bold text-2xl text-accent">${avgLiters} L</p></div><div class="bg-secondary p-4 rounded-lg"><p class="text-gray-600">Lowest Intake</p><p class="font-bold text-2xl text-red-500">${loggedDays > 0 ? lowestIntake : 'N/A'} glasses</p></div>`; if (waterChartInstance) { waterChartInstance.destroy(); } waterChartInstance = new Chart(canvasEl, { type: 'line', data: { labels: labels, datasets: [{ label: 'Glasses of Water', data: dataPoints, borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: pointBackgroundColors, fill: false, tension: 0.1, spanGaps: true }] }, options: { scales: { y: { beginAtZero: true, max: 14 } }, plugins: { legend: { display: false } } } }); }
    document.getElementById('prev-month-btn-progress')?.addEventListener('click', () => { progressDisplayedDate.setMonth(progressDisplayedDate.getMonth() - 1); renderWaterIntakeChart(); });
    document.getElementById('next-month-btn-progress')?.addEventListener('click', () => { progressDisplayedDate.setMonth(progressDisplayedDate.getMonth() + 1); renderWaterIntakeChart(); });

    checkAuth();
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if(currentPage.includes('index.html')) { loadHomePageData(); }
    else if(currentPage.includes('stats.html')) { loadStatsPageData(); }
    else if(currentPage.includes('routine.html')) { loadFullRoutinePage(); }
});