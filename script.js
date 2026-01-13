document.addEventListener('DOMContentLoaded', () => {
    // Inputs
    // Inputs
    const targetAltInput = document.getElementById('target-alt');
    const lowAltInput = document.getElementById('low-alt');
    const lowWindInput = document.getElementById('low-wind'); // Combined
    const highAltInput = document.getElementById('high-alt');
    const highWindInput = document.getElementById('high-wind'); // Combined

    const magVarInput = document.getElementById('mag-var');
    const courseInput = document.getElementById('course');
    const tasInput = document.getElementById('tas');
    const outboundBaseTimeInput = document.getElementById('outbound-base-time');

    // Outputs - Common
    const interpWindDisplay = document.getElementById('interp-wind-display');
    const magWindDisplay = document.getElementById('mag-wind-display');
    const calcMaxDrift = document.getElementById('calc-max-drift');

    // Outputs - Inbound
    const calcSingleDrift = document.getElementById('calc-single-drift');
    const calcInboundHdg = document.getElementById('calc-inbound-hdg');

    // Outputs - Outbound
    const calcOutboundCourse = document.getElementById('calc-outbound-course');
    const calcOutboundSingleDrift = document.getElementById('calc-outbound-single-drift');
    const calcOutboundCorrection = document.getElementById('calc-outbound-correction');
    const calcOutboundHdg = document.getElementById('calc-outbound-hdg');
    const calcOutboundTime = document.getElementById('calc-outbound-time');

    // Canvas
    const canvas = document.getElementById('hold-viz');
    const ctx = canvas.getContext('2d');

    const inputs = [
        targetAltInput, lowAltInput, lowWindInput,
        highAltInput, highWindInput, magVarInput,
        courseInput, tasInput, outboundBaseTimeInput
    ];

    inputs.forEach(input => {
        input.addEventListener('input', calculateAll);
    });

    function parseWind(val) {
        if (!val) return { dir: 0, spd: 0 };
        const parts = val.toString().split('/');
        if (parts.length < 2) return { dir: parseFloat(parts[0]) || 0, spd: 0 };
        return { dir: parseFloat(parts[0]) || 0, spd: parseFloat(parts[1]) || 0 };
    }

    function calculateAll() {
        // --- 1. WINDS ---
        const tAlt = parseFloat(targetAltInput.value) || 0;
        const lAlt = parseFloat(lowAltInput.value) || 0;
        const hAlt = parseFloat(highAltInput.value) || 0;

        const lowParsed = parseWind(lowWindInput.value);
        const lDir = lowParsed.dir;
        const lSpd = lowParsed.spd;

        const highParsed = parseWind(highWindInput.value);
        const hDir = highParsed.dir;
        const hSpd = highParsed.spd;

        let windDir, windSpd;

        if (hAlt === lAlt) {
            windDir = lDir;
            windSpd = lSpd;
        } else {
            const ratio = (tAlt - lAlt) / (hAlt - lAlt);

            let diffDir = hDir - lDir;
            if (diffDir > 180) diffDir -= 360;
            if (diffDir < -180) diffDir += 360;

            windDir = lDir + (diffDir * ratio);
            windDir = (windDir + 360) % 360;
            windSpd = lSpd + (hSpd - lSpd) * ratio;
        }

        const iDir = Math.round(windDir);
        const iSpd = Math.round(windSpd);
        interpWindDisplay.textContent = `${pad0(iDir)}/${iSpd}`;

        const variation = parseFloat(magVarInput.value) || 0;
        let magDir = iDir + variation;
        magDir = (magDir + 360) % 360;
        magWindDisplay.textContent = `${pad0(magDir)}/${iSpd}`;

        // --- 2. CONFIG ---
        const inboundCourse = parseFloat(courseInput.value) || 0;
        const tas = parseFloat(tasInput.value) || 120;
        const standardMaxDrift = Math.round((iSpd * 60) / tas); // Round to integer
        calcMaxDrift.textContent = `${standardMaxDrift}°`;

        // --- 3. INBOUND LEG ---
        // Normal Single Drift logic
        const inboundRes = calculateDrift(inboundCourse, magDir, standardMaxDrift);
        calcSingleDrift.textContent = `${inboundRes.acuteAngle}°(${inboundRes.factorText}) -> ${inboundRes.singleDrift}`;

        // Inbound Heading = Course +/- Single Drift
        const inboundHdg = applyCorrection(inboundCourse, magDir, inboundRes.singleDrift);
        calcInboundHdg.textContent = `${pad0(Math.round(inboundHdg))}°`;

        // --- 4. OUTBOUND LEG ---
        const outboundCourse = (inboundCourse + 180) % 360;
        calcOutboundCourse.textContent = `${pad0(outboundCourse)}`;

        // Calculate Single Drift for Outbound (Drift Check)
        const outboundRes = calculateDrift(outboundCourse, magDir, standardMaxDrift);

        // User Rule: Outbound Correction based on Angle vs 30 degrees.
        // If angle > 30 -> 3 * MaxDrift.
        // If angle <= 30 -> 2 * MaxDrift.

        let finalCorrection = 0;
        let logText = "";

        if (outboundRes.acuteAngle > 30) {
            finalCorrection = outboundRes.singleDrift * 3;
            logText = `3x SingleDrift (${outboundRes.singleDrift}) = ${finalCorrection}`;
        } else {
            finalCorrection = outboundRes.singleDrift * 2;
            logText = `2x SingleDrift (${outboundRes.singleDrift}) = ${finalCorrection}`;
        }

        calcOutboundSingleDrift.textContent = `${outboundRes.singleDrift.toFixed(1)}`;
        calcOutboundCorrection.textContent = logText;

        const outboundHdg = applyCorrection(outboundCourse, magDir, finalCorrection);
        calcOutboundHdg.textContent = `${pad0(Math.round(outboundHdg))}°`;

        // Time Calculation (Seconds)
        const outBaseTime = parseFloat(outboundBaseTimeInput.value) || 60;

        // 1. Angle Difference between Inbound Course and Wind (0-180)
        let angleDiff = Math.abs(inboundCourse - magDir);
        while (angleDiff > 180) angleDiff = 360 - angleDiff;

        // 2. Headwind/Tailwind Logic
        // If Inbound Diff < 90, it's a Headwind on Inbound.
        // Inbound Headwind -> Outbound Tailwind.
        // Tailwind -> Fly Faster -> Less Time (Subtract)
        // Headwind -> Fly Slower -> More Time (Add)
        const isOutboundTailwind = angleDiff < 90;

        // 3. Calculate Input for Clock Code Rule: (90 - AcuteAngleDiff)
        let acuteDiff = angleDiff;
        if (acuteDiff > 90) acuteDiff = 180 - acuteDiff;

        // User Rule: "90 - angle difference"
        let ruleAngle = 90 - acuteDiff;

        // 4. Clock Code Factor
        // >= 53 (near 60) -> 1.0
        // >= 38 (near 45) -> 0.75
        // >= 23 (near 30) -> 0.5
        // >= 12 (near 15) -> 0.33
        let timeFactor = 0;

        if (ruleAngle >= 53) {
            timeFactor = 1;
        } else if (ruleAngle >= 38) {
            timeFactor = 0.75;
        } else if (ruleAngle >= 23) {
            timeFactor = 0.5;
        } else if (ruleAngle > 0) {
            timeFactor = 1 / 3;
        } else {
            timeFactor = 0;
        }

        const correctionSpeed = iSpd * timeFactor;

        let finalTime = 0;
        if (isOutboundTailwind) {
            finalTime = outBaseTime - correctionSpeed;
        } else {
            finalTime = outBaseTime + correctionSpeed;
        }

        calcOutboundTime.textContent = `${Math.round(finalTime)} sec`;

        // DRAW VISUALIZATION
        // Pass calculated time (rounded)
        drawHold(inboundCourse, magDir, iSpd, Math.round(finalTime), Math.round(inboundHdg), Math.round(outboundHdg));
    }

    function calculateDrift(course, windDir, maxDrift) {
        let windAngle = Math.abs(course - windDir);
        if (windAngle > 180) windAngle = 360 - windAngle;

        let acuteAngle = windAngle;
        if (acuteAngle > 90) acuteAngle = 180 - acuteAngle;

        let driftFactor = 0;
        let factorText = "0";

        if (acuteAngle >= 53) {
            driftFactor = 1;
            factorText = "1";
        } else if (acuteAngle >= 38) {
            driftFactor = 0.75; // 3/4 (Nearest to 45)
            factorText = "3/4";
        } else if (acuteAngle >= 23) {
            driftFactor = 0.5; // 1/2 (Nearest to 30)
            factorText = "1/2";
        } else if (acuteAngle > 0) {
            driftFactor = 1 / 3; // 1/3 (Nearest to 15?)
            factorText = "1/3";
        } else {
            driftFactor = 0;
            factorText = "0";
        }

        // Single Drift = MaxDrift * Factor (per user update)
        const singleDrift = Math.round(maxDrift * driftFactor);

        return {
            acuteAngle,
            factorText,
            singleDrift
        };
    }

    function applyCorrection(course, windDir, correction) {
        let relativeWind = windDir - course;
        while (relativeWind <= -180) relativeWind += 360;
        while (relativeWind > 180) relativeWind -= 360;

        let heading = course;
        if (relativeWind < 0) {
            heading = course - correction;
        } else {
            heading = course + correction;
        }
        return (heading + 360) % 360;
    }

    function pad0(n) {
        return n.toString().padStart(3, '0');
    }

    function drawHold(inboundCourse, windDir, windSpd, outboundTime, inboundHdg, outboundHdg) {
        // High DPI Support
        const logicalSize = 800;
        const dpr = window.devicePixelRatio || 1;

        // Ensure canvas internal resolution matches screen density
        if (canvas.width !== logicalSize * dpr || canvas.height !== logicalSize * dpr) {
            canvas.width = logicalSize * dpr;
            canvas.height = logicalSize * dpr;
        }

        // Reset transform to handle re-draws correctly
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Scale coordinate system to Logical Size (800x800)
        ctx.scale(dpr, dpr);

        const cx = logicalSize / 2;
        const cy = logicalSize / 2;

        // --- 1. COMPASS ROSE (Background) ---

        ctx.strokeStyle = '#444';
        ctx.fillStyle = '#666';
        ctx.lineWidth = 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '16px Arial';

        const rOuter = 380;
        const rTickMaj = 350;
        const rCardinalText = 320;
        const rText = 330;

        // Draw Ticks & Labels
        for (let deg = 0; deg < 360; deg++) {
            const rad = (deg - 90) * Math.PI / 180;

            const isCardinal = deg % 90 === 0;
            const isMajor = deg % 30 === 0;
            const isTen = deg % 10 === 0;
            const isFive = deg % 5 === 0;

            let rInner;
            let strokeWidth = 1;

            if (isCardinal) {
                rInner = 340;
                strokeWidth = 3;
            } else if (isMajor) {
                rInner = 350;
                strokeWidth = 2;
            } else if (isTen) {
                rInner = 360;
                strokeWidth = 2;
            } else if (isFive) {
                rInner = 365;
                strokeWidth = 1;
            } else {
                rInner = 372;
                strokeWidth = 0.5;
            }

            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(rad) * rOuter, cy + Math.sin(rad) * rOuter);
            ctx.lineTo(cx + Math.cos(rad) * rInner, cy + Math.sin(rad) * rInner);
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            if (isMajor) {
                let label = pad0(deg);
                const tRad = isCardinal ? rCardinalText : rText;
                const tx = cx + Math.cos(rad) * tRad;
                const ty = cy + Math.sin(rad) * tRad;

                if (deg === 0) label = "N";
                if (deg === 90) label = "E";
                if (deg === 180) label = "S";
                if (deg === 270) label = "W";

                ctx.lineWidth = 1;
                ctx.fillText(label, tx, ty);
            }
        }

        ctx.save();
        ctx.translate(cx, cy);

        // --- 2. DRAW HOLD (Rotated) ---
        ctx.save();
        ctx.rotate((inboundCourse - 90) * Math.PI / 180);

        const scale = 1.6;
        const legLen = 140 * scale;
        const radius = 45 * scale;

        const lx = -legLen;
        const rx = 0;
        const ty = 0;
        const by = radius * 2;

        ctx.strokeStyle = '#98ff98';
        ctx.lineWidth = 5;
        ctx.fillStyle = '#98ff98';

        // Inbound Leg
        ctx.beginPath();
        ctx.moveTo(lx, ty);
        ctx.lineTo(rx, ty);
        ctx.stroke();

        // Arrow
        drawArrowHead(ctx, lx / 2, ty, 0, '#98ff98');

        // Fix
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, 2 * Math.PI);
        ctx.fill();

        // Turn 1
        ctx.beginPath();
        ctx.arc(0, radius, radius, 1.5 * Math.PI, 0.5 * Math.PI, false);
        ctx.stroke();

        // Outbound Leg
        ctx.beginPath();
        ctx.moveTo(0, by);
        ctx.lineTo(lx, by);
        ctx.stroke();

        // Inbound Labels (TRK/HDG)
        ctx.save();
        ctx.translate(lx / 2, -35); // Above Inbound Leg
        ctx.rotate(-(inboundCourse - 90) * Math.PI / 180); // Upright
        ctx.fillStyle = '#ccc';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`TRK ${pad0(inboundCourse)}°`, 0, -8);
        ctx.fillText(`HDG ${pad0(inboundHdg)}°`, 0, 8);
        ctx.restore();

        // Outbound Labels (TRK/HDG)
        ctx.save();
        ctx.translate(lx / 2, by + 35); // Below Outbound Leg
        ctx.rotate(-(inboundCourse - 90) * Math.PI / 180); // Upright
        ctx.fillStyle = '#ccc';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        const outTrack = (inboundCourse + 180) % 360; // Calculate local outbound track
        ctx.fillText(`TRK ${pad0(outTrack)}°`, 0, -8);
        ctx.fillText(`HDG ${pad0(outboundHdg)}°`, 0, 8);
        ctx.restore();

        // Turn 2
        ctx.beginPath();
        ctx.arc(lx, radius, radius, 0.5 * Math.PI, 1.5 * Math.PI, false);
        ctx.stroke();

        // --- Gate 1 Marker (Beginning of Inbound Turn / End of Outbound Leg) ---
        // Location: (lx, by)
        ctx.beginPath();
        ctx.arc(lx, by, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff00ff'; // Magenta
        ctx.fill();

        ctx.fillStyle = '#ff00ff';
        ctx.font = 'bold 18px Arial';

        ctx.save();
        ctx.translate(lx - 15, by + 15);
        ctx.rotate(-(inboundCourse - 90) * Math.PI / 180); // Keep upright
        ctx.textAlign = 'right';
        ctx.fillText(`Gate 1 ${outboundTime}s`, 0, 0);
        ctx.restore();

        // --- Gate 2 Marker (End of Inbound Turn / Start of Inbound Leg) ---
        // Location: (lx, 0)
        ctx.beginPath();
        ctx.arc(lx, 0, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffaa00';
        ctx.fill();

        let gate2Deg = (inboundCourse - 60);
        if (gate2Deg < 0) gate2Deg += 360;

        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 18px Arial';

        // Upright label for Gate 2
        ctx.save();
        ctx.translate(lx - 15, -15);
        ctx.rotate(-(inboundCourse - 90) * Math.PI / 180); // Keep upright
        ctx.textAlign = 'right';
        ctx.fillText(`Gate 2 ${pad0(Math.round(gate2Deg))}°`, 0, 0);
        ctx.restore();

        // Fix Label (Upright)
        ctx.save();
        ctx.translate(25, -25);
        ctx.rotate(-(inboundCourse - 90) * Math.PI / 180);
        ctx.font = '20px Arial';
        ctx.fillStyle = '#98ff98';
        ctx.textAlign = 'left';
        ctx.fillText("FIX", 0, 0);
        ctx.restore();

        ctx.restore();

        // --- 3. WIND ARROW (Absolute) ---
        const windRad = (windDir - 90) * Math.PI / 180;

        const wStart = 320; // Brought inside to prevent text clipping
        const wEnd = 120;

        const x1 = Math.cos(windRad) * wStart;
        const y1 = Math.sin(windRad) * wStart;
        const x2 = Math.cos(windRad) * wEnd;
        const y2 = Math.sin(windRad) * wEnd;

        ctx.strokeStyle = '#4488ff';
        ctx.lineWidth = 6;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        drawArrowHead(ctx, x2, y2, windRad + Math.PI, '#4488ff', 30);

        ctx.fillStyle = '#4488ff';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(`WIND ${pad0(windDir)}`, x1, y1 + (y1 < 0 ? -25 : 25));

        ctx.restore();
    }

    function drawArrowHead(ctx, x, y, radians, color, size = 10) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(radians);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, size / 2);
        ctx.lineTo(-size, -size / 2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    calculateAll(); // Run once
});
