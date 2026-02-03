(() => {
  const DEFAULT_SEPARATORS = {
    component: ":",
    element: "+",
    decimal: ".",
    release: "?",
    segment: "'",
  };

  const SEGMENT_LABELS = {
    UNB: "Interchange Header",
    UNH: "Message Header",
    BGM: "Beginning of Message",
    DTM: "Date/Time/Period",
    NAD: "Name and Address",
    CTA: "Contact Information",
    COM: "Communication Contact",
    RFF: "Reference",
    TOD: "Terms of Delivery or Transport",
    CPS: "Consignment Packing Sequence",
    PAC: "Package",
    PCI: "Package Identification",
    GIN: "Goods Identity Number",
    LIN: "Line Item",
    PIA: "Additional Product Id",
    IMD: "Item Description",
    QTY: "Quantity",
    ALI: "Additional Information",
    UNS: "Section Control",
    CNT: "Control Total",
    PRI: "Price Details",
    MOA: "Monetary Amount",
    UNT: "Message Trailer",
    UNZ: "Interchange Trailer",
  };

  function cleanLeading(text) {
    if (!text) return text;
    return text.replace(/^[\ufeff \t\r\n]+/, "");
  }

  function detectSeparators(text) {
    if (text.startsWith("UNA") && text.length >= 8) {
      const component = text[3];
      const element = text[4];
      const decimal = text[5];
      const release = text[6];
      let segment = text.length >= 9 ? text[8] : text[7];
      if (segment.trim() === "" && text.length >= 10) {
        const candidate = text[9];
        if (candidate.trim() !== "") {
          segment = candidate;
        }
      }
      return { component, element, decimal, release, segment };
    }
    return { ...DEFAULT_SEPARATORS };
  }

  function stripServiceStringAdvice(text, separators) {
    if (text.startsWith("UNA") && text.length >= 8) {
      const localSeps = separators || detectSeparators(text);
      const terminator = localSeps.segment || DEFAULT_SEPARATORS.segment;
      const end = text.indexOf(terminator, 3);
      if (end !== -1) {
        return text.slice(end + 1);
      }
      return text.length >= 9 ? text.slice(9) : text.slice(8);
    }
    return text;
  }

  function splitEscaped(text, sep, release) {
    const items = [];
    let buf = "";
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        buf += ch;
        escaped = false;
        continue;
      }
      if (ch === release) {
        escaped = true;
        continue;
      }
      if (ch === sep) {
        items.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    items.push(buf);
    return items;
  }

  function splitSegments(text, sep, release) {
    return splitEscaped(text, sep, release).filter((seg) => seg.trim() !== "");
  }

  function parseMessage(text) {
    const cleaned = cleanLeading(text || "");
    const separators = detectSeparators(cleaned);
    let stripped = stripServiceStringAdvice(cleaned, separators);
    stripped = stripped.replace(/^[\ufeff \t\r\n]+/, "");
    const segments = splitSegments(stripped, separators.segment, separators.release);
    const parsedSegments = segments.map((raw, idx) => {
      const rawSegment = raw.trim();
      const parts = splitEscaped(rawSegment, separators.element, separators.release);
      const tag = parts[0] || "";
      const elements = [];
      for (const element of parts.slice(1)) {
        if (element.includes(separators.component)) {
          elements.push(splitEscaped(element, separators.component, separators.release));
        } else {
          elements.push([element]);
        }
      }
      return { index: idx, tag, elements, raw: rawSegment };
    });
    return { separators, segments: parsedSegments, rawText: cleaned };
  }

  function safeComponent(seg, elementIndex, componentIndex) {
    if (!seg) return "";
    const idx = elementIndex - 1;
    if (idx < 0 || idx >= seg.elements.length) return "";
    const components = seg.elements[idx];
    if (componentIndex < 0 || componentIndex >= components.length) return "";
    return components[componentIndex];
  }

  function safeInt(value) {
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? null : num;
  }

  function issue(severity, code, message, seg) {
    return {
      severity,
      code,
      message,
      segment_index: seg ? seg.index + 1 : null,
      segment_tag: seg ? seg.tag : null,
      segment_raw: seg ? seg.raw : null,
    };
  }

  function diff(kind, segment, left, right, index) {
    return { type: kind, segment, left, right, index: index + 1 };
  }

  function findSegment(segments, tag) {
    return segments.find((seg) => seg.tag === tag) || null;
  }

  function findSegments(segments, tag) {
    return segments.filter((seg) => seg.tag === tag);
  }

  function splitMessages(segments) {
    const messages = [];
    let current = [];
    for (const seg of segments) {
      if (seg.tag === "UNH") {
        if (current.length) messages.push(current);
        current = [seg];
        continue;
      }
      if (current.length) {
        current.push(seg);
        if (seg.tag === "UNT") {
          messages.push(current);
          current = [];
        }
      }
    }
    if (current.length) messages.push(current);
    return messages;
  }

  function validateUna(rawText, separators) {
    const issues = [];
    if (!rawText.startsWith("UNA")) return issues;
    if (rawText.length < 9) {
      issues.push(issue("error", "una_short", "UNA segment is too short (expected 9 chars).", null));
      return issues;
    }
    const terminator = separators.segment || DEFAULT_SEPARATORS.segment;
    const unaEnd = rawText.indexOf(terminator, 3);
    if (unaEnd === -1) {
      issues.push(issue("error", "una_missing_terminator", "UNA terminator is missing.", null));
      return issues;
    }
    if (unaEnd !== 8 && unaEnd !== 9) {
      issues.push(issue("warning", "una_length", "UNA length is unusual; expected 9 chars.", null));
    }
    const chars = rawText.slice(3, unaEnd);
    if (chars.length < 5) {
      issues.push(issue("error", "una_invalid", "UNA does not define all separators.", null));
      return issues;
    }
    if (chars[4] !== " ") {
      issues.push(issue("warning", "una_reserved", "UNA reserved separator is unusual.", null));
    }
    if (new Set(chars).size !== chars.length) {
      issues.push(issue("warning", "una_duplicate_sep", "UNA defines duplicate separator characters.", null));
    }
    return issues;
  }

  function validateSeparators(rawText, separators) {
    const issues = [];
    if (!rawText) return issues;
    let body = rawText;
    if (rawText.startsWith("UNA")) {
      const terminator = separators.segment || DEFAULT_SEPARATORS.segment;
      const end = rawText.indexOf(terminator, 3);
      if (end !== -1) {
        body = rawText.slice(end + 1);
      }
    }
    const elementSep = separators.element || DEFAULT_SEPARATORS.element;
    const componentSep = separators.component || DEFAULT_SEPARATORS.component;
    const segmentSep = separators.segment || DEFAULT_SEPARATORS.segment;
    if (!body.includes(elementSep) && body.includes(DEFAULT_SEPARATORS.element)) {
      issues.push(issue("warning", "separator_mismatch", "Element separator does not match UNA.", null));
    }
    if (!body.includes(segmentSep)) {
      issues.push(issue("error", "segment_terminator_missing", "Segment terminator not found in data.", null));
    }
    if (body.includes(DEFAULT_SEPARATORS.component)) {
      if (!body.includes(componentSep)) {
        issues.push(issue("warning", "component_separator_mismatch", "Component separator does not match UNA.", null));
      } else {
        const defaultCount = body.split(DEFAULT_SEPARATORS.component).length - 1;
        const currentCount = body.split(componentSep).length - 1;
        if (componentSep !== DEFAULT_SEPARATORS.component && defaultCount > currentCount * 2) {
          issues.push(
            issue(
              "warning",
              "component_separator_mismatch",
              "Component separator appears inconsistent with UNA.",
              null,
            ),
          );
        }
      }
    }
    return issues;
  }

  function validateInterchangeControls(segments) {
    const issues = [];
    const unbs = findSegments(segments, "UNB");
    const unzs = findSegments(segments, "UNZ");
    if (unbs.length > 1) {
      issues.push(issue("warning", "multiple_unb", "Multiple UNB segments found.", unbs[0]));
    }
    if (unzs.length > 1) {
      issues.push(issue("warning", "multiple_unz", "Multiple UNZ segments found.", unzs[0]));
    }
    const unb = unbs[0] || null;
    const unz = unzs.length ? unzs[unzs.length - 1] : null;
    if (unb && unz) {
      const unbRef = safeComponent(unb, 5, 0);
      const unzRef = safeComponent(unz, 2, 0);
      if (unbRef && unzRef && unbRef !== unzRef) {
        issues.push(issue("error", "unb_unz_ref_mismatch", "UNB/UNZ control reference mismatch.", unz));
      }
    }
    return issues;
  }

  function validateMessageControls(segments) {
    const issues = [];
    let currentUnh = null;
    let countSinceUnh = 0;
    for (const seg of segments) {
      if (seg.tag === "UNH") {
        currentUnh = seg;
        countSinceUnh = 1;
        continue;
      }
      if (currentUnh) countSinceUnh += 1;
      if (seg.tag === "UNT" && currentUnh) {
        const unhRef = safeComponent(currentUnh, 1, 0);
        const untRef = safeComponent(seg, 2, 0);
        if (unhRef && untRef && unhRef !== untRef) {
          issues.push(issue("error", "unh_unt_ref_mismatch", "UNH/UNT message reference mismatch.", seg));
        }
        const declared = safeInt(safeComponent(seg, 1, 0));
        if (declared !== null && declared !== countSinceUnh) {
          issues.push(issue("error", "unt_count", "UNT segment count does not match actual count.", seg));
        }
        currentUnh = null;
        countSinceUnh = 0;
      }
    }
    return issues;
  }

  function validateCounts(segments) {
    const issues = [];
    const unhCount = findSegments(segments, "UNH").length;
    const unz = findSegment(segments, "UNZ");
    if (unz) {
      const declared = safeInt(safeComponent(unz, 1, 0));
      if (declared !== null && declared !== unhCount) {
        issues.push(issue("error", "unz_count", "UNZ count does not match number of messages.", unz));
      }
    }
    for (const message of splitMessages(segments)) {
      const linCount = message.filter((seg) => seg.tag === "LIN").length;
      for (const cnt of message.filter((seg) => seg.tag === "CNT")) {
        const qualifier = safeComponent(cnt, 1, 0);
        const value = safeInt(safeComponent(cnt, 1, 1));
        if (qualifier === "2" && value !== null && value !== linCount) {
          issues.push(issue("warning", "cnt_lin_mismatch", "CNT line count does not match LIN segments.", cnt));
        }
      }
    }
    return issues;
  }

  function validateDtmFormats(segments) {
    const issues = [];
    const formatLengths = {
      101: 6,
      102: 8,
      103: 8,
      201: 4,
      203: 12,
      204: 12,
      303: 12,
      304: 12,
    };
    for (const dtm of findSegments(segments, "DTM")) {
      const value = safeComponent(dtm, 1, 1);
      const fmt = safeComponent(dtm, 1, 2);
      if (!value || !fmt) continue;
      const expected = formatLengths[fmt];
      if (expected && (value.length !== expected || !/^\d+$/.test(value))) {
        issues.push(issue("warning", "dtm_format", "DTM value does not match declared format.", dtm));
      }
    }
    return issues;
  }

  function validateNumericDecimals(segments, separators) {
    const issues = [];
    const decimalMark = separators.decimal || DEFAULT_SEPARATORS.decimal;
    const checkTags = new Set(["QTY", "MOA", "PRI"]);
    for (const seg of segments) {
      if (!checkTags.has(seg.tag)) continue;
      for (const element of seg.elements) {
        for (const component of element) {
          if (!component) continue;
          if (/\d/.test(component)) {
            if (decimalMark === "." && component.includes(",")) {
              issues.push(issue("warning", "decimal_mark", "Numeric value uses comma decimal but UNA defines dot.", seg));
              return issues;
            }
            if (decimalMark === "," && component.includes(".")) {
              issues.push(issue("warning", "decimal_mark", "Numeric value uses dot decimal but UNA defines comma.", seg));
              return issues;
            }
          }
        }
      }
    }
    return issues;
  }

  function validateLinSequences(segments) {
    const issues = [];
    const lineNumbers = [];
    for (const seg of findSegments(segments, "LIN")) {
      const lineNo = safeComponent(seg, 1, 0);
      if (lineNo) lineNumbers.push(lineNo);
    }
    if (!lineNumbers.length) return issues;
    const seen = new Set();
    for (const ln of lineNumbers) {
      if (seen.has(ln)) {
        issues.push(issue("warning", "lin_duplicate", "Duplicate LIN line numbers found.", null));
        break;
      }
      seen.add(ln);
    }
    const numeric = lineNumbers.filter((ln) => /^\d+$/.test(ln));
    if (numeric.length === lineNumbers.length) {
      const values = lineNumbers.map((ln) => Number.parseInt(ln, 10));
      const sorted = [...values].sort((a, b) => a - b);
      if (!values.every((value, idx) => value === sorted[idx])) {
        issues.push(issue("warning", "lin_order", "LIN line numbers are not in order.", null));
      }
    }
    return issues;
  }

  function summarizeMessage(segments) {
    const summary = {};
    const unb = findSegment(segments, "UNB");
    if (unb) {
      summary.sender = safeComponent(unb, 2, 0);
      summary.receiver = safeComponent(unb, 3, 0);
      summary.date = safeComponent(unb, 4, 0);
      summary.time = safeComponent(unb, 4, 1);
    }
    const unh = findSegment(segments, "UNH");
    if (unh) {
      summary.message_type = safeComponent(unh, 2, 0);
      summary.message_version = safeComponent(unh, 2, 1);
      summary.message_release = safeComponent(unh, 2, 2);
      summary.message_agency = safeComponent(unh, 2, 3);
    }
    summary.segment_count = segments.length;
    return summary;
  }

  function analyzeMessage(parsed) {
    const segments = parsed.segments || [];
    const separators = parsed.separators || { ...DEFAULT_SEPARATORS };
    const rawText = parsed.rawText || "";
    const issues = [];
    if (!segments.length) {
      issues.push(issue("error", "empty", "No segments found in message.", null));
      return { issues, summary: {} };
    }
    issues.push(...validateUna(rawText, separators));
    issues.push(...validateSeparators(rawText, separators));
    const tags = segments.map((seg) => seg.tag).filter(Boolean);
    if (tags.length && !["UNA", "UNB"].includes(tags[0])) {
      issues.push(issue("warning", "missing_unb", "Message does not start with UNB.", segments[0]));
    }
    if (!findSegment(segments, "UNH")) {
      issues.push(issue("error", "missing_unh", "Message header (UNH) is missing.", null));
    }
    if (!findSegment(segments, "UNT")) {
      issues.push(issue("error", "missing_unt", "Message trailer (UNT) is missing.", null));
    }
    issues.push(...validateInterchangeControls(segments));
    issues.push(...validateMessageControls(segments));
    issues.push(...validateCounts(segments));
    issues.push(...validateDtmFormats(segments));
    issues.push(...validateNumericDecimals(segments, separators));
    issues.push(...validateLinSequences(segments));
    for (const seg of segments) {
      if (!seg.tag) {
        issues.push(issue("error", "empty_tag", "Segment tag is empty.", seg));
        continue;
      }
      seg.elements.forEach((element, idx) => {
        if (element.length === 1 && element[0] === "") {
          issues.push(
            issue("warning", "empty_element", `Empty data element at position ${idx + 1}.`, seg),
          );
        }
      });
    }
    return { issues, summary: summarizeMessage(segments) };
  }

  function isDescriptiveText(value) {
    if (!value) return false;
    if (value.includes(" ")) return true;
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    if (hasUpper && hasLower && value.length > 5) return true;
    return false;
  }

  function isNumericValue(value) {
    if (!value) return false;
    if (value.includes(".") || value.includes(",")) return true;
    if (/^\d+$/.test(value) && value.length > 4) return true;
    if (/^\d{6,}$/.test(value)) return true;
    return false;
  }

  function segmentKey(seg) {
    if (["UNB", "UNZ", "UNH", "UNT", "BGM", "ALI", "UNS", "CNT"].includes(seg.tag)) {
      return "";
    }
    const elem1Comp0 = safeComponent(seg, 1, 0);
    const elem2Comp0 = safeComponent(seg, 2, 0);
    const elem2Comp1 = safeComponent(seg, 2, 1);
    const elem3Comp0 = safeComponent(seg, 3, 0);
    const keyParts = [];
    if (elem1Comp0) keyParts.push(elem1Comp0);
    if (
      elem2Comp0 &&
      elem2Comp0.length <= 20 &&
      !isNumericValue(elem2Comp0) &&
      !isDescriptiveText(elem2Comp0)
    ) {
      keyParts.push(elem2Comp0);
    }
    if (
      elem2Comp1 &&
      elem2Comp1.length <= 20 &&
      !isNumericValue(elem2Comp1) &&
      !isDescriptiveText(elem2Comp1)
    ) {
      keyParts.push(elem2Comp1);
    }
    if (
      elem3Comp0 &&
      elem3Comp0.length <= 20 &&
      !elem2Comp0 &&
      !isNumericValue(elem3Comp0) &&
      !isDescriptiveText(elem3Comp0)
    ) {
      keyParts.push(elem3Comp0);
    }
    return keyParts.length ? keyParts.join("|") : "";
  }

  function segmentSignature(seg) {
    const key = segmentKey(seg);
    if (key) return `${seg.tag}|${key}`;
    return seg.tag;
  }

  function structurallyEqual(a, b) {
    if (!a || !b) return false;
    if (a.tag !== b.tag) return false;
    if (a.elements.length !== b.elements.length) return false;
    for (let i = 0; i < a.elements.length; i += 1) {
      if (a.elements[i].length !== b.elements[i].length) return false;
    }
    return true;
  }

  function getOpcodes(a, b) {
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        if (a[i] === b[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ tag: "equal", i1: i, i2: i + 1, j1: j, j2: j + 1 });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ tag: "delete", i1: i, i2: i + 1, j1: j, j2: j });
        i += 1;
      } else {
        ops.push({ tag: "insert", i1: i, i2: i, j1: j, j2: j + 1 });
        j += 1;
      }
    }
    while (i < n) {
      ops.push({ tag: "delete", i1: i, i2: i + 1, j1: j, j2: j });
      i += 1;
    }
    while (j < m) {
      ops.push({ tag: "insert", i1: i, i2: i, j1: j, j2: j + 1 });
      j += 1;
    }
    const merged = [];
    for (const op of ops) {
      const last = merged[merged.length - 1];
      if (last && last.tag === op.tag && last.i2 === op.i1 && last.j2 === op.j1) {
        last.i2 = op.i2;
        last.j2 = op.j2;
      } else {
        merged.push({ ...op });
      }
    }
    const finalOps = [];
    for (let idx = 0; idx < merged.length; idx += 1) {
      const current = merged[idx];
      const next = merged[idx + 1];
      if (current.tag === "delete" && next && next.tag === "insert") {
        finalOps.push({
          tag: "replace",
          i1: current.i1,
          i2: current.i2,
          j1: next.j1,
          j2: next.j2,
        });
        idx += 1;
      } else {
        finalOps.push(current);
      }
    }
    return finalOps;
  }

  function diffMessages(left, right, includeEqual = false, forgiving = false) {
    const leftSegments = left.segments || [];
    const rightSegments = right.segments || [];
    const diffs = [];
    const leftSignatures = leftSegments.map(segmentSignature);
    const rightSignatures = rightSegments.map(segmentSignature);
    const opcodes = getOpcodes(leftSignatures, rightSignatures);
    for (const op of opcodes) {
      const { tag, i1, i2, j1, j2 } = op;
      if (tag === "equal") {
        for (let offset = 0; offset < i2 - i1; offset += 1) {
          const lseg = leftSegments[i1 + offset];
          const rseg = rightSegments[j1 + offset];
          if (forgiving) {
            if (!structurallyEqual(lseg, rseg)) {
              diffs.push(diff("changed", lseg.tag, lseg.raw, rseg.raw, i1 + offset));
            } else if (includeEqual) {
              diffs.push(diff("same", lseg.tag, lseg.raw, rseg.raw, i1 + offset));
            }
          } else if (lseg.raw !== rseg.raw) {
            diffs.push(diff("changed", lseg.tag, lseg.raw, rseg.raw, i1 + offset));
          } else if (includeEqual) {
            diffs.push(diff("same", lseg.tag, lseg.raw, rseg.raw, i1 + offset));
          }
        }
        continue;
      }
      if (tag === "delete") {
        for (let idx = i1; idx < i2; idx += 1) {
          const lseg = leftSegments[idx];
          diffs.push(diff("removed", lseg.tag, lseg.raw, "", idx));
        }
        continue;
      }
      if (tag === "insert") {
        for (let idx = j1; idx < j2; idx += 1) {
          const rseg = rightSegments[idx];
          diffs.push(diff("added", rseg.tag, "", rseg.raw, idx));
        }
        continue;
      }
      if (tag === "replace") {
        const rightPool = new Map();
        for (let idx = j1; idx < j2; idx += 1) {
          const rseg = rightSegments[idx];
          const key = segmentKey(rseg);
          const poolKey = `${rseg.tag}||${key}`;
          if (!rightPool.has(poolKey)) rightPool.set(poolKey, []);
          rightPool.get(poolKey).push(idx);
        }
        const usedRight = new Set();
        for (let idx = i1; idx < i2; idx += 1) {
          const lseg = leftSegments[idx];
          const key = segmentKey(lseg);
          const poolKey = `${lseg.tag}||${key}`;
          const bucket = rightPool.get(poolKey) || [];
          let matchIdx = null;
          while (bucket.length) {
            const candidate = bucket.shift();
            if (!usedRight.has(candidate)) {
              matchIdx = candidate;
              break;
            }
          }
          if (matchIdx !== null) {
            usedRight.add(matchIdx);
            const rseg = rightSegments[matchIdx];
            if (forgiving) {
              if (!structurallyEqual(lseg, rseg)) {
                diffs.push(diff("changed", lseg.tag, lseg.raw, rseg.raw, idx));
              } else if (includeEqual) {
                diffs.push(diff("same", lseg.tag, lseg.raw, rseg.raw, idx));
              }
            } else if (lseg.raw !== rseg.raw) {
              diffs.push(diff("changed", lseg.tag, lseg.raw, rseg.raw, idx));
            } else if (includeEqual) {
              diffs.push(diff("same", lseg.tag, lseg.raw, rseg.raw, idx));
            }
          } else {
            diffs.push(diff("removed", lseg.tag, lseg.raw, "", idx));
          }
        }
        for (let idx = j1; idx < j2; idx += 1) {
          if (usedRight.has(idx)) continue;
          const rseg = rightSegments[idx];
          diffs.push(diff("added", rseg.tag, "", rseg.raw, idx));
        }
      }
    }
    return diffs;
  }

  window.EdiEdifact = {
    DEFAULT_SEPARATORS,
    SEGMENT_LABELS,
    parseMessage,
    analyzeMessage,
    diffMessages,
    getOpcodes,
  };
})();
