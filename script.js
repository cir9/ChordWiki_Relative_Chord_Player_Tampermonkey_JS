// ==UserScript==
// @name         ChordWiki Relative Chord & Audio Player
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  为 ja.chordwiki.org 自动计算相对级数和弦，支持复杂和弦拆分、连续低音推导与 Tone.js 试听功能
// @author       You
// @match        *://ja.chordwiki.org/*
// @require      https://unpkg.com/tone@14.7.77/build/Tone.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /* ==========================================================================
       1. 和弦解析引擎 
       ========================================================================== */
    const NoteName = {
        Unknown: 65536,
        C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
        I: 7, II: 8, III: 9, IV: 10, V: 11, VI: 12, VII: 13,
        _1: 14, _2: 15, _3: 16, _4: 17, _5: 18, _6: 19, _7: 20,
    };

    const NoteNameEnum = {
        0: 'C', 1: 'D', 2: 'E', 3: 'F', 4: 'G', 5: 'A', 6: 'B'
    };

    class Note {
        constructor(name = NoteName.C, tune = 0) {
            this.name = name;
            this.tune = tune;
        }
        static get Empty() { return new Note(NoteName.C, 0); }
    }

    const reg_chord_name = /([Nn]\.?[Cc]\.?)|(?:\/)([#♯xb♭♮]?[#♯b♭]?|\b)([a-gA-G])([#♯xb♭♮]?[#♯b♭]?)|(\b|[#♯xb♭♮][#♯b♭]?)([a-gA-G])([#♯xb♭♮]?[#♯b♭]?)(\+|[Aa][Uu][Gg]|°|[Dd][Ii][Mm]|[ØøΦ∅]|)([ØøΦ∅]|(?:[m-]|[Mm]in)(?:[MΔ△]|[Mm]aj)|[Mm]aj(?:or)?|MAJ(?:OR)?|[Mm]in(?:or)?|MIN(?:OR)?|[Ii]on(?:ian)?|ION(?:IAN)?|[Dd]or(?:ian)?|DOR(?:IAN)?|[Pp]hr(?:y|ygian)?|PHR(?:Y|YGIAN)?|[Ll]yd(?:ian)?|LYD(?:IAN)?|[Mm]ix(?:o|olydian)?|MIX(?:O|OLYDIAN)?|[Aa]eo(?:lian)?|AEO(?:LIAN)?|[Ll]oc(?:rian)?|LOC(?:RIAN)?|[m-]|[MΔ△]|)(\+|[Aa][Uu][Gg]|°|[Dd][Ii][Mm]|[ØøΦ∅]|)(sus(?!\d)|)(69|11|13|[796513]|)((?:sus[#♯b♭]?[24]?){1,2}|)(\s?\(?(?:omi?t|omit)\s?[0-9,\s]+\)?|)(?:(\+(?!\d)|[Aa][Uu][Gg]|°|[Dd][Ii][Mm]|[ØøΦ∅])\s?(7)?|)(\s?|\s?\(?[Aa]lt(?:ered)?\.\)?)?(\(?(?:[Aa][Dd][Dd])?(?:(?:[#♯b♭♮+-]?)(?:11|13|69|[79651234]))?(?:(?:[\b\/,. ]|\)?\(|[#♯b♭+-]?)[#♯b♭+-]?(?:11|13|[79651234]))*\)?)(?:(?:\/|[Oo][Nn])([#♯b♭]?[#♯xb♭♮]?)([a-gA-G])([#♯xb♭♮]?[#♯b♭]?)|)(\s?\(?(?:omi?t|omit)\s?[0-9,\s]+\)?|)(?!\w)/g;
    const reg_sharp = /[#♯+]/g;
    const reg_double_sharp = /x/g;
    const reg_flat = /[b♭-]/g;

    function toDBC(str) {
        let result = "";
        for (let i = 0; i < str.length; i++) {
            let charCode = str.charCodeAt(i);
            if (charCode >= 65281 && charCode <= 65374) {
                result += String.fromCharCode(charCode - 65248);
            } else if (charCode === 12288) {
                result += String.fromCharCode(32);
            } else {
                result += str.charAt(i);
            }
        }
        return result;
    }

    function parseNote(notationLeft, name, notationRight) {
        if (!name || name.length === 0) return null;
        name = name.toUpperCase();
        const notation = (notationLeft || "") + (notationRight || "");
        const sharpCount = (notation.match(reg_sharp) || []).length;
        const doubleSharpCount = (notation.match(reg_double_sharp) || []).length;
        const flatCount = (notation.match(reg_flat) || []).length;
        const semitones = sharpCount + 2 * doubleSharpCount - flatCount;
        return new Note(NoteName[name], semitones);
    }

    // --- 相对级数算法 ---
    const majorScaleIntervals = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B

    function noteToAbsSemitone(note) {
        if (!note || note.name >= 7) return 0;
        return majorScaleIntervals[note.name] + note.tune;
    }

    // 根据目标音和主音(Key)，计算相对级数（例如 C 大调下的 Eb 返回 "b3"）
    function getRelativeDegreeStr(targetNote, keyNote) {
        if (!targetNote || targetNote.name >= 7) return "";
        let nameDiff = (targetNote.name - keyNote.name + 7) % 7;
        let targetAbs = noteToAbsSemitone(targetNote);
        let keyAbs = noteToAbsSemitone(keyNote);
        let semiDiff = (targetAbs - keyAbs + 120) % 12;

        let majorSemi = majorScaleIntervals[nameDiff];
        let tuneDiff = semiDiff - majorSemi;
        while(tuneDiff > 6) tuneDiff -= 12;
        while(tuneDiff < -6) tuneDiff += 12;

        let prefix = "";
        if (tuneDiff > 0) prefix = "#".repeat(tuneDiff);
        else if (tuneDiff < 0) prefix = "b".repeat(-tuneDiff);

        return prefix + (nameDiff + 1).toString();
    }

    // 核心提取：将文本中的所有和弦识别，并把根音替换为相对级数
    function extractRelativeChords(chordText, keyNote, state) {
        if (!keyNote) return [];
        let results = [];
        let match;
        let cleanStr = toDBC(chordText);

        reg_chord_name.lastIndex = 0;
        while ((match = reg_chord_name.exec(cleanStr)) !== null) {
            const groups = match;
            if (groups[1]) {
                // 遇到 N.C. 重置状态
                state.relBase = "";
                state.absBase = "";
                continue;
            }

            let relText = "";
            let targetDegree = "1";
            let isChord = false;
            let originalText = match[0].trim();

            if (groups[3]) { // 仅有 Bass 的分数和弦 (如 /C)
                let bassNote = parseNote(groups[2], groups[3], groups[4]);
                if (bassNote) {
                    let deg = getRelativeDegreeStr(bassNote, keyNote);

                    // 继承前一个主和弦的基础属性（解决类似 Absus2.../C 的情况）
                    if (state.relBase) {
                        relText = state.relBase + "/" + deg;
                    } else {
                        relText = "/" + deg;
                    }
                    targetDegree = deg;
                    isChord = true;

                    if (state.absBase) {
                        originalText = state.absBase + originalText; // 例如 "Absus2" + "/C"
                    }
                }
            } else if (groups[6]) { // 常规和弦
                let chordRoot = parseNote(groups[5], groups[6], groups[7]);
                let absBase = "";
                let relBase = "";

                if (chordRoot) {
                    let rootDeg = getRelativeDegreeStr(chordRoot, keyNote);
                    relBase = rootDeg;
                    absBase = (groups[5] || "") + (groups[6] || "") + (groups[7] || "");

                    // 原封不动提取修饰符
                    for (let i = 8; i <= 18; i++) {
                        if (groups[i]) {
                            relBase += groups[i];
                            absBase += groups[i];
                        }
                    }
                    if (groups[22]) {
                        relBase += groups[22];
                        absBase += groups[22];
                    }

                    // 更新上下文缓存
                    state.relBase = relBase;
                    state.absBase = absBase;

                    relText = relBase;
                    targetDegree = rootDeg;
                    isChord = true;

                    if (groups[20]) { // 带有 Slash Bass
                        let slashBass = parseNote(groups[19], groups[20], groups[21]);
                        if (slashBass) {
                            let bassDeg = getRelativeDegreeStr(slashBass, keyNote);
                            relText += "/" + bassDeg;
                            targetDegree = bassDeg; // 使用 Bass 的级数决定颜色
                        }
                    }
                }
            }

            if (isChord) {
                results.push({
                    text: relText,
                    targetDegree: targetDegree,
                    originalText: originalText // 用于音频发声
                });
            }
        }
        return results;
    }

    /* ==========================================================================
       2. 音频播放引擎 (保留原有的快速发声解析)
       ========================================================================== */
    const _note_index_arr = [...[...Array(7).keys()].map(i => i + 1)];
    const _note_index_map = { 'b1': 0, '1': 0, '#1': 0, 'b2': 1, '2': 1, '#2': 1, 'b3': 2, '3': 2, '#3': 2, 'b4': 3, '4': 3, '#4': 3, 'b5': 4, '5': 4, '#5': 4, 'b6': 5, '6': 5, '#6': 5, 'b7': 6, '7': 6, '#7': 6 };
    const _note_C_map = { 'b1': 'Cb', '1': 'C', '#1': 'C#', 'b2': 'Db', '2': 'D', '#2': 'D#', 'b3': 'Eb', '3': 'E', '#3': 'E#', 'b4': 'Fb', '4': 'F', '#4': 'F#', 'b5': 'Gb', '5': 'G', '#5': 'G#', 'b6': 'Ab', '6': 'A', '#6': 'A#', 'b7': 'Bb', '7': 'B', '#7': 'B#' };
    const _note_abs_map = { 'Cb': -1, 'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'E#': 5, 'Fb': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11, 'B#': 12 };
    const _chord_root_map = { 'bI': 'b1', 'I': '1', '#I': '#1', 'bII': 'b2', 'II': '2', '#II': '#2', 'bIII': 'b3', 'III': '3', '#III': '#3', 'bIV': 'b4', 'IV': '4', '#IV': '#4', 'bV': 'b5', 'V': '5', '#V': '#5', 'bVI': 'b6', 'VI': '6', '#VI': '#6', 'bVII': 'b7', 'VII': '7', '#VII': '#7' };
    const _letter_to_root_map = { 'C': '1', 'C#': '#1', 'Cb': 'b1', 'D': '2', 'D#': '#2', 'Db': 'b2', 'E': '3', 'E#': '#3', 'Eb': 'b3', 'F': '4', 'F#': '#4', 'Fb': 'b4', 'G': '5', 'G#': '#5', 'Gb': 'b5', 'A': '6', 'A#': '#6', 'Ab': 'b6', 'B': '7', 'B#': '#7', 'Bb': 'b7' };
    const _note_name_map = { 'b1': 11, '1': 0, '#1': 1, 'b2': 1, '2': 2, '#2': 3, 'b3': 3, '3': 4, '#3': 5, 'b4': 4, '4': 5, '#4': 6, 'b5': 6, '5': 7, '#5': 8, 'b6': 8, '6': 9, '#6': 10, 'b7': 10, '7': 11, '#7': 0, '': -1 };
    const _note_hi_map = { 'b1': -1, '1': 0, '#1': 1, 'b2': 1, '2': 2, '#2': 3, 'b3': 3, '3': 4, '#3': 5, 'b4': 4, '4': 5, '#4': 6, 'b5': 6, '5': 7, '#5': 8, 'b6': 8, '6': 9, '#6': 10, 'b7': 10, '7': 11, '#7': 12, '': -10 };

    // 补入 d7(减七度9半音)
    const _tension_map = { 'P1': 0, 'm2': 1, 'M2': 2, 'm3': 3, 'M3': 4, 'd4': 4, 'P4': 5, 'A4': 6, 'd5': 6, 'P5': 7, 'A5': 8, 'm6': 8, 'M6': 9, 'd7': 9, 'm7': 10, 'M7': 11, '-5': 6, '5': 7, '+5': 8, 'b5': 6, '#5': 8, 'b9': 1, '9': 2, '#9': 3, 'b11': 4, '11': 5, '#11': 6, 'b13': 8, '13': 9, 'sus2': 2, 'sus4': 5, 'susb2': 1, 'sus#2': 3, 'susb4': 4, 'sus#4': 6 };
    const _tension_index_map = { 'P1': 0, 'm2': 1, 'M2': 1, 'm3': 2, 'M3': 2, 'd4': 3, 'P4': 3, 'A4': 3, 'd5': 4, 'P5': 4, 'A5': 4, 'm6': 5, 'M6': 5, 'd7': 6, 'm7': 6, 'M7': 6, '-5': 4, 'b5': 4, '5': 4, '+5': 4, 'b9': 1, '9': 1, '#9': 1, 'b11': 3, '11': 3, '#11': 3, 'b13': 5, '13': 5, 'sus2': 1, 'sus4': 3, 'susb2': 1, 'sus#2': 1, 'susb4': 3, 'sus#4': 3 };

    function addSemitones(note, add_index, add_semitones) {
        let node_s = _note_name_map[note], node_i = _note_index_map[note];
        let res_s = (node_s + add_semitones + 132) % 12;
        let res_i = (node_i + add_index + 77) % 7;
        let add = '', s_delta = res_s - _note_name_map[_note_index_arr[res_i].toString()];
        s_delta = (s_delta + 126) % 12 - 6;
        if (s_delta <= -2) return addSemitones(note, add_index + 6, add_semitones);
        if (s_delta >= 2) return addSemitones(note, add_index + 1, add_semitones);
        if (s_delta < 0) add = 'b'.repeat(-s_delta);
        else if (s_delta > 0) add = '#'.repeat(s_delta);
        return add + _note_index_arr[res_i];
    }
    function addInterval(note, interval) { return addSemitones(note, _tension_index_map[interval], _tension_map[interval]); }

    const _reg_chord_old = /([b#]?(?:IV|I{1,3}|VI{0,2}|[A-G])[b#]?)([+°ø]|[Aa]ug|[Dd]im|)([Mm]aj|[Mm]in|mM|[Mm]|[Mm]aj[Mm]min|)(11|13|69|[12345679]|[Dd]om|)([+-]5|)(sus[b#]?2)?(sus[b#]?4)?(alt)?(?:\(?(?:add)?([0-9,b#]+)\)?|)(?:\(?(?:add)?([0-9,b#]+)\)?|)(?:\(omit([0-9,]+)\)|)(?:\/([b#]?[1-7A-G][b#]?)|)/;

    function parseChordForAudio(str) {
        let cleanStr = str.replace(/m7b5|m7-5/g, "ø");
        let match = _reg_chord_old.exec(cleanStr);
        if (!match) return null;
        return {
            root: match[1], mod: match[2] || '', quality: match[3] || '', degree: match[4] || '', fifth: match[5] || '',
            sus2: match[6] || '', sus4: match[7] || '', alt: match[8] || '',
            tensions: [...(match[10] || '').split(','), ...(match[9] || '').split(',')].filter(s => s),
            omits: match[11] ? match[11].split(',') : [], slash: match[12] || '',
        };
    }

    const _quality_map = { 'M': ['M3', 'M7'], 'maj': ['M3', 'M7'], 'Maj': ['M3', 'M7'], 'm': ['m3', 'm7'], 'min': ['m3', 'm7'], 'Min': ['m3', 'm7'], 'mM': ['m3', 'M7'], '': ['M3', 'm7'], '+': ['M3', 'm7'], 'ø': ['m3', 'm7'], '°': ['m3', 'd7'] };
    const _mod_fifth_map = { '+': '+5', '+5': '+5', '°': '-5', '-5': '-5', 'ø': '-5', '': '5' };
    const _degree_map = { '': [true, true, true, false], '1': [true, false, false, false], '2': [true, false, false, false], '3': [true, true, false, false], '4': [true, false, false, false], '5': [true, false, true, false], '6': [true, true, true, false], '7': [true, true, true, true], '9': [true, true, true, true], '11': [true, true, true, true], '13': [true, true, true, true], '69': [true, true, true, false] };
    const _degree_add_map = { '': [], '1': [], '2': ['9'], '3': [], '4': ['11'], '5': [], '6': ['13'], '7': [], '9': ['9'], '11': ['9', '11'], '13': ['9', '11', '13'], '69': ['9', '13'] };
    const _omit_map = { '1': 0, '3': 1, '5': 2, '7': 3 };

    function toNoteAbs(note) {
        let num = note.slice(-1);
        let other = note.slice(0, -1);
        return _note_abs_map[other] + num * 12;
    }

    function getChordTones({ root, mod, quality, degree, fifth, sus2, sus4, alt, tensions, omits, slash }) {
        if (mod == 'ø' && degree == '') degree = '7';
        if (mod.toLowerCase() == 'aug') mod = "+";
        if (mod.toLowerCase() == 'dim') mod = "°";
        if (quality.toLowerCase() == 'dom') quality = "7";

        let rootKey = _chord_root_map[root] || _letter_to_root_map[root];
        if (!rootKey) return null;

        let raw_fifth = _mod_fifth_map[mod];
        let q_37 = _quality_map[quality || mod];

        let deg_t = ['P1', q_37[0], raw_fifth, q_37[1]];
        let deg_b = [..._degree_map[degree]];
        if (sus2 || sus4) deg_b[1] = false;
        if (fifth) deg_b[2] = false;
        let adds = [..._degree_add_map[degree]]; adds.push(...tensions);
        omits.forEach(o => { deg_b[_omit_map[o]] = false; });

        let tones = [];
        if (deg_b[0]) tones.push(deg_t[0]);
        if (deg_b[1]) tones.push(deg_t[1]);
        if (sus2) tones.push(sus2);
        if (sus4) tones.push(sus4);
        if (deg_b[2]) tones.push(deg_t[2]);
        if (fifth) tones.push(fifth);
        if (deg_b[3]) tones.push(deg_t[3]);
        tones.push(...adds);

        let notes = tones.map(t => addInterval(rootKey, t));
        let bassStr = slash || root;
        let bassKey = _chord_root_map[bassStr] || _letter_to_root_map[bassStr] || (slash ? slash : rootKey);

        let plays = [];
        let lastNote = '';
        let octave = 4;

        for (let n of notes) {
            if (lastNote && _note_hi_map[lastNote] > _note_hi_map[n] && octave <= 4) octave++;
            plays.push(`${_note_C_map[n]}${octave}`);
            lastNote = n;
        }

        return {
            bass: `${_note_C_map[bassKey]}3`,
            notes: [...new Set(plays)].sort((a, b) => toNoteAbs(a) - toNoteAbs(b)),
        };
    }

    let audioStarted = false;
    let synth, bassSynth;

    async function initAudio() {
        if (audioStarted) return;
        await Tone.start();
        const masterComp = new Tone.Compressor({ threshold: -20, ratio: 4, attack: 0.05, release: 0.25 }).toDestination();

        synth = new Tone.PolySynth(Tone.FMSynth).connect(masterComp);
        synth.set({ envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.8 }, volume: -14 });

        bassSynth = new Tone.PolySynth(Tone.Synth).connect(masterComp);
        bassSynth.set({ volume: -8 });

        audioStarted = true;
    }

    async function playChordStr(absoluteChordStr) {
        await initAudio();
        let parsed = parseChordForAudio(absoluteChordStr);
        if (!parsed) {
            console.log(`[Audio] 无法解析和弦: ${absoluteChordStr}`);
            return;
        }
        let tones = getChordTones(parsed);
        if (!tones) {
            console.log(`[Audio] 无法生成和弦音符: ${absoluteChordStr}`, parsed);
            return;
        }
        synth.releaseAll();
        bassSynth.releaseAll();
        // ----------------------------------------------------
        // Console 输出详情方便 Debug
        console.log(`[Audio] 正在播放和弦: ${absoluteChordStr}`, {
            parsedDetail: parsed,
            bassNotePlay: tones.bass,
            chordNotesPlay: tones.notes
        });

        const now = Tone.now();
        bassSynth.triggerAttackRelease(tones.bass, "2n", now);
        synth.triggerAttackRelease(tones.notes, "2n", now);
    }

    /* ==========================================================================
       3. DOM 注入与 UI 样式生成
       ========================================================================== */
    function getCSSStyleForDegree(degreeStr) {
        const colors = ['#ff5252', '#ffb142', '#ffda79', '#33d9b2', '#34ace0', '#706fd3', '#ff52a5'];
        let num = parseInt(degreeStr.replace(/[b#]/g, ''));
        if (isNaN(num)) return `border-color: #555; color: #555;`;
        let index = (num - 1) % 7;
        let mainColor = colors[index];

        if (degreeStr.includes('#')) {
            let nextColor = colors[(index + 1) % 7];
            return `border: 4px solid transparent; background: linear-gradient(#2c2c34, #2c2c34) padding-box, repeating-linear-gradient(45deg, ${mainColor}, ${mainColor} 4px, ${nextColor} 4px, ${nextColor} 8px) border-box; color: #fff;`;
        } else if (degreeStr.includes('b')) {
            let prevColor = colors[(index - 1 + 7) % 7];
            return `border: 4px solid transparent; background: linear-gradient(#2c2c34, #2c2c34) padding-box, repeating-linear-gradient(45deg, ${prevColor}, ${prevColor} 4px, ${mainColor} 4px, ${mainColor} 8px) border-box; color: #fff;`;
        }
        return `border: 4px solid ${mainColor}; background: #2c2c34; color: #fff;`;
    }

    function injectPlugin() {
        const elements = document.querySelectorAll('.main p.key, .main span.key, .main span.chord');
        let currentKeyNote = new Note(NoteName.C, 0); // 默认 Key C
        let chordState = { relBase: "", absBase: "" }; // 跨 span 保存和弦主干状态

        elements.forEach(el => {
            if (el.classList.contains('key')) {
                let text = el.textContent.replace(/Key:/i, '').trim();
                let match = /^([a-gA-G])([#♯b♭]*)/.exec(text);

                // 每次转调清空和弦缓存状态
                chordState = { relBase: "", absBase: "" };

                if (match) {
                    let parsedKey = parseNote("", match[1], match[2]);
                    if (parsedKey) {
                        // 小调检测逻辑：如果包含 'm' 或 'minor'，且排除 'maj' 的干扰，则转为大调
                        if (/m(?!aj)|minor/i.test(text)) {
                            let newName = (parsedKey.name + 2) % 7; // 小三度上移
                            let newAbs = (noteToAbsSemitone(parsedKey) + 3) % 12;
                            let newTune = newAbs - majorScaleIntervals[newName];
                            // 归一化修饰符
                            while(newTune > 6) newTune -= 12;
                            while(newTune < -6) newTune += 12;

                            currentKeyNote = new Note(newName, newTune);
                            console.log(`[Key Parsed] 侦测到小调: ${text} -> 转换为关系大调: ${NoteNameEnum[newName]} (tune: ${newTune})`);
                        } else {
                            currentKeyNote = parsedKey;
                            console.log(`[Key Parsed] 侦测到大调: ${text} -> ${NoteNameEnum[parsedKey.name]} (tune: ${parsedKey.tune})`);
                        }
                    }
                }
            }
            else if (el.classList.contains('chord')) {
                let originalChordText = Array.from(el.childNodes)
                                             .filter(n => n.nodeType === Node.TEXT_NODE)
                                             .map(n => n.nodeValue)
                                             .join('')
                                             .trim();

                if (originalChordText === 'N.C.' || originalChordText === '') {
                    chordState = { relBase: "", absBase: "" }; // 遇到空和弦或停顿清空状态
                    return;
                }

                // 提取文本中全部能够解析的和弦，并支持基于 chordState 推导连续低音
                let relChords = extractRelativeChords(originalChordText, currentKeyNote, chordState);

                relChords.forEach(relData => {
                    let relSpan = document.createElement('span');
                    relSpan.className = 'rel-chord-plugin';
                    relSpan.textContent = ` ${relData.text} `;

                    relSpan.style.cssText = `
                        display: inline-block;
                        margin-left: 4px;
                        padding: 0 4px;
                        font-size: 0.8em;
                        font-family: monospace;
                        font-weight: bold;
                        border-radius: 6px;
                        cursor: pointer;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        transition: transform 0.1s;
                        user-select: none;
                        ${getCSSStyleForDegree(relData.targetDegree)}
                    `;

                    // 绑定 Tone.js 播放与动画交互
                    relSpan.onmousedown = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        relSpan.style.transform = 'scale(0.9)';
                        playChordStr(relData.originalText);
                    };

                    relSpan.onmouseup = (e) => {
                        e.stopPropagation();
                        relSpan.style.transform = 'scale(1)';
                    };

                    relSpan.onmouseleave = () => relSpan.style.transform = 'scale(1)';
                    relSpan.onclick = (e) => e.stopPropagation();

                    // 依次注入
                    el.appendChild(relSpan);
                });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectPlugin);
    } else {
        injectPlugin();
    }
})();
