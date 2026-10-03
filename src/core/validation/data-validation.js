// @ts-check

/** @typedef {import('../../data/types.js').ValidationIssue} ValidationIssue */
/** @typedef {import('../../data/types.js').ValidationAudit} ValidationAudit */
/** @typedef {import('../../data/types.js').ValidationResult} ValidationResult */
/** @typedef {import('../../data/types.js').RuntimeDataset} RuntimeDataset */

const EXPECTED_SCHEMA_VERSION = "2.0";

/**
 * Validates the canonical source without mutating it, then derives the runtime
 * hierarchy. Raw schedule values remain audit evidence and never override a
 * canonical value.
 *
 * @param {unknown} input
 * @returns {ValidationResult}
 */
export function validateAndBuildDataset(input) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  /** @type {ValidationAudit} */
  const audit = {
    packages: 0,
    days: 0,
    sessions: 0,
    activities: 0,
    segments: 0,
    resolvedAnomalies: 0,
    unresolvedAnomalies: 0,
  };

  if (!isRecord(input)) {
    addIssue(issues, "error", "INVALID_ROOT", "$", "يجب أن يكون جذر البيانات كائنًا.");
    return { ok: false, issues, audit, model: null };
  }

  if (input.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    addIssue(
      issues,
      "error",
      "UNSUPPORTED_SCHEMA_VERSION",
      "$.schemaVersion",
      `إصدار المخطط المتوقع ${EXPECTED_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(input.packages)) {
    addIssue(issues, "error", "MISSING_PACKAGES", "$.packages", "packages يجب أن تكون مصفوفة.");
    return { ok: false, issues, audit, model: null };
  }

  const summary = isRecord(input.validationSummary) ? input.validationSummary : null;
  if (!summary) {
    addIssue(issues, "error", "MISSING_VALIDATION_SUMMARY", "$.validationSummary", "ملخص التحقق مفقود.");
  } else {
    audit.resolvedAnomalies = arrayLength(summary.resolved);
    audit.unresolvedAnomalies = arrayLength(summary.unresolved);
    validateSummaryCounts(summary, issues);
  }

  const themeCatalog = isRecord(input.themeCatalog) && isRecord(input.themeCatalog.tracks)
    ? input.themeCatalog.tracks
    : null;
  if (!themeCatalog) {
    addIssue(issues, "error", "MISSING_THEME_CATALOG", "$.themeCatalog.tracks", "دليل ألوان المسارات مفقود.");
  }

  const packageIds = new Set();
  const activityIds = new Set();
  const segmentKeys = new Set();
  /** @type {Map<string, {title: string, theme: Record<string, unknown>, programs: Map<string, {title: string, records: any[]}>}>} */
  const tracks = new Map();

  input.packages.forEach((rawPackage, packageIndex) => {
    const packagePath = `$.packages[${packageIndex}]`;
    if (!isRecord(rawPackage)) {
      addIssue(issues, "error", "INVALID_PACKAGE", packagePath, "سجل الحقيبة غير صالح.");
      return;
    }
    audit.packages += 1;

    const packageId = requiredString(rawPackage.id, issues, `${packagePath}.id`);
    const trackTitle = requiredString(rawPackage.track, issues, `${packagePath}.track`);
    const programTitle = requiredString(rawPackage.program, issues, `${packagePath}.program`);
    if (!packageId || !trackTitle || !programTitle) return;

    ensureUnique(packageIds, packageId, issues, "DUPLICATE_PACKAGE_ID", `${packagePath}.id`);
    validateTheme(rawPackage.theme, themeCatalog?.[trackTitle], issues, `${packagePath}.theme`);

    if (!Array.isArray(rawPackage.days)) {
      addIssue(issues, "error", "MISSING_DAYS", `${packagePath}.days`, "days يجب أن تكون مصفوفة.");
      return;
    }

    const days = rawPackage.days.map((day, dayIndex) =>
      buildDay(day, {
        packageId,
        packagePath: `${packagePath}.days[${dayIndex}]`,
        issues,
        audit,
        activityIds,
        segmentKeys,
      }),
    ).filter(Boolean);

    const trackId = makeKey("track", trackTitle);
    let track = tracks.get(trackId);
    if (!track) {
      track = {
        title: trackTitle,
        theme: isRecord(themeCatalog?.[trackTitle]) ? themeCatalog[trackTitle] : {},
        programs: new Map(),
      };
      tracks.set(trackId, track);
    }

    const programId = `${trackId}/${makeKey("program", programTitle)}`;
    let program = track.programs.get(programId);
    if (!program) {
      program = { title: programTitle, records: [] };
      track.programs.set(programId, program);
    }
    program.records.push({ rawPackage, packageId, days });
  });

  if (summary) {
    compareCount(summary.packageCount, audit.packages, issues, "SUMMARY_PACKAGE_COUNT", "$.validationSummary.packageCount");
    compareCount(summary.sessionCount, audit.sessions, issues, "SUMMARY_SESSION_COUNT", "$.validationSummary.sessionCount");
    compareCount(summary.activityCount, audit.activities, issues, "SUMMARY_ACTIVITY_COUNT", "$.validationSummary.activityCount");
    compareCount(summary.timedSegmentCount, audit.segments, issues, "SUMMARY_SEGMENT_COUNT", "$.validationSummary.timedSegmentCount");
  }

  /** @type {RuntimeDataset} */
  const model = {
    schemaVersion: String(input.schemaVersion),
    status: typeof input.status === "string" ? input.status : "unknown",
    tracks: [...tracks.entries()].map(([trackId, track]) => ({
      id: trackId,
      title: track.title,
      theme: track.theme,
      programs: [...track.programs.entries()].map(([programId, program]) =>
        buildProgram(programId, program.title, program.records, issues),
      ),
    })),
    reviewItems: issues.filter((issue) => issue.severity === "review"),
  };

  if (summary) {
    const unresolvedPlacements = issues.filter((issue) => issue.code === "UNRESOLVED_BREAK_PLACEMENT").length;
    compareCount(
      audit.unresolvedAnomalies,
      unresolvedPlacements,
      issues,
      "SUMMARY_UNRESOLVED_ITEMS_MISMATCH",
      "$.validationSummary.unresolved",
    );
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  if (hasErrors) return { ok: false, issues, audit, model: null };

  return { ok: true, issues, audit, model };
}

/** @param {string} programId @param {string} title @param {any[]} records @param {ValidationIssue[]} issues */
function buildProgram(programId, title, records, issues) {
  const directRecords = records.filter((record) => record.rawPackage.package == null);
  const packagedRecords = records.filter((record) => record.rawPackage.package != null);

  if (directRecords.length && packagedRecords.length) {
    addIssue(issues, "error", "MIXED_PROGRAM_STRUCTURE", programId, "لا يمكن خلط أيام مباشرة وحقائب داخل البرنامج نفسه.");
  }
  if (directRecords.length > 1) {
    addIssue(issues, "error", "DUPLICATE_DIRECT_PROGRAM_DATA", programId, "يوجد أكثر من سجل أيام مباشر للبرنامج.");
  }

  if (directRecords.length) {
    const record = directRecords[0];
    return {
      id: programId,
      title,
      structure: "direct",
      sourceRecordId: record.packageId,
      sourceFile: stringOrEmpty(record.rawPackage.sourceFile),
      theme: record.rawPackage.theme,
      days: record.days,
    };
  }

  return {
    id: programId,
    title,
    structure: "packages",
    packages: packagedRecords.map((record) => ({
      id: record.packageId,
      code: String(record.rawPackage.package),
      sourceFile: stringOrEmpty(record.rawPackage.sourceFile),
      theme: record.rawPackage.theme,
      days: record.days,
    })),
  };
}

/** @param {unknown} rawDay @param {{packageId:string,packagePath:string,issues:ValidationIssue[],audit:ValidationAudit,activityIds:Set<string>,segmentKeys:Set<string>}} context */
function buildDay(rawDay, context) {
  const { packageId, packagePath, issues, audit, activityIds, segmentKeys } = context;
  if (!isRecord(rawDay)) {
    addIssue(issues, "error", "INVALID_DAY", packagePath, "سجل اليوم غير صالح.");
    return null;
  }
  audit.days += 1;
  const dayNumber = positiveNumber(rawDay.day, issues, `${packagePath}.day`);
  if (dayNumber == null) return null;
  const dayId = `${packageId}/day:${dayNumber}`;

  if (!Array.isArray(rawDay.sessions)) {
    addIssue(issues, "error", "MISSING_SESSIONS", `${packagePath}.sessions`, "sessions يجب أن تكون مصفوفة.");
    return null;
  }

  const sessions = rawDay.sessions.map((session, index) =>
    buildSession(session, {
      packageId,
      dayNumber,
      sessionPath: `${packagePath}.sessions[${index}]`,
      issues,
      audit,
      activityIds,
      segmentKeys,
    }),
  ).filter(Boolean);

  const externalBreaks = Array.isArray(rawDay.externalBreaks)
    ? rawDay.externalBreaks.map((item, index) => buildExternalBreak(item, dayId, index, issues, `${packagePath}.externalBreaks[${index}]`)).filter(Boolean)
    : [];
  if (!Array.isArray(rawDay.externalBreaks)) {
    addIssue(issues, "error", "MISSING_EXTERNAL_BREAKS", `${packagePath}.externalBreaks`, "externalBreaks يجب أن تكون مصفوفة.");
  }

  const canonicalInstructionalMinutes = nullablePositiveNumber(rawDay.canonicalInstructionalMinutes, issues, `${packagePath}.canonicalInstructionalMinutes`);
  const canonicalBreakMinutes = positiveNumber(rawDay.canonicalBreakMinutes, issues, `${packagePath}.canonicalBreakMinutes`, true);
  const canonicalTotalMinutes = nullablePositiveNumber(rawDay.canonicalTotalMinutes, issues, `${packagePath}.canonicalTotalMinutes`);
  const scheduleTotalMinutes = positiveNumber(rawDay.scheduleTotalMinutes, issues, `${packagePath}.scheduleTotalMinutes`);
  const canonicalStatus = stringOrEmpty(rawDay.canonicalStatus);

  const sessionTotal = sessions.reduce((sum, session) => sum + (session.canonicalInstructionalMinutes ?? 0), 0);
  if (canonicalInstructionalMinutes != null && canonicalInstructionalMinutes !== sessionTotal) {
    addIssue(issues, "error", "DAY_INSTRUCTIONAL_SUM_MISMATCH", packagePath, "مجموع الجلسات لا يطابق الزمن التعليمي Canonical لليوم.");
  }

  const allEmbeddedBreaks = sessions.flatMap((session) => [...session.placedBreaks, ...session.unplacedBreaks]);
  const breakTotal = [...externalBreaks, ...allEmbeddedBreaks].reduce((sum, item) => sum + item.durationMinutes, 0);
  if (canonicalBreakMinutes != null && canonicalBreakMinutes !== breakTotal) {
    addIssue(issues, "error", "DAY_BREAK_SUM_MISMATCH", packagePath, "مجموع الاستراحات لا يطابق زمن الاستراحات Canonical.");
  }
  if (
    canonicalTotalMinutes != null &&
    canonicalInstructionalMinutes != null &&
    canonicalBreakMinutes != null &&
    canonicalTotalMinutes !== canonicalInstructionalMinutes + canonicalBreakMinutes
  ) {
    addIssue(issues, "error", "DAY_TOTAL_SUM_MISMATCH", packagePath, "الإجمالي Canonical لا يساوي التعليم مع الاستراحات.");
  }

  const blocked = canonicalStatus.includes("blocked") || canonicalInstructionalMinutes == null || canonicalTotalMinutes == null;
  if (blocked) {
    addIssue(issues, "review", "DAY_BLOCKED", dayId, "اليوم غير قابل للتشغيل الكامل حتى اعتماد بياناته Canonical.");
  }

  return {
    id: dayId,
    order: dayNumber,
    canonicalInstructionalMinutes,
    canonicalBreakMinutes: canonicalBreakMinutes ?? 0,
    canonicalTotalMinutes,
    scheduleTotalMinutes: scheduleTotalMinutes ?? 0,
    canonicalStatus,
    sessions,
    externalBreaks,
    reviewRequired: blocked || sessions.some((session) => session.unplacedBreaks.length > 0),
  };
}

/** @param {unknown} rawSession @param {{packageId:string,dayNumber:number,sessionPath:string,issues:ValidationIssue[],audit:ValidationAudit,activityIds:Set<string>,segmentKeys:Set<string>}} context */
function buildSession(rawSession, context) {
  const { packageId, dayNumber, sessionPath, issues, audit, activityIds, segmentKeys } = context;
  if (!isRecord(rawSession)) {
    addIssue(issues, "error", "INVALID_SESSION", sessionPath, "سجل الجلسة غير صالح.");
    return null;
  }
  audit.sessions += 1;
  const sessionNumber = positiveNumber(rawSession.session, issues, `${sessionPath}.session`);
  if (sessionNumber == null) return null;
  const sessionId = `${packageId}/day:${dayNumber}/session:${sessionNumber}`;
  const canonicalStatus = stringOrEmpty(rawSession.canonicalStatus);
  const canonicalMinutes = nullablePositiveNumber(rawSession.canonicalInstructionalMinutes, issues, `${sessionPath}.canonicalInstructionalMinutes`);

  if (!Array.isArray(rawSession.activities)) {
    addIssue(issues, "error", "MISSING_ACTIVITIES", `${sessionPath}.activities`, "activities يجب أن تكون مصفوفة.");
    return null;
  }

  const blocked = canonicalStatus.includes("blocked") || canonicalMinutes == null;
  const activities = rawSession.activities.map((activity, activityIndex) => {
    const activityPath = `${sessionPath}.activities[${activityIndex}]`;
    if (!isRecord(activity)) {
      addIssue(issues, "error", "INVALID_ACTIVITY", activityPath, "سجل النشاط غير صالح.");
      return null;
    }
    audit.activities += 1;
    const activityId = requiredString(activity.id, issues, `${activityPath}.id`);
    const officialCode = requiredString(activity.officialCode, issues, `${activityPath}.officialCode`);
    const order = positiveNumber(activity.order, issues, `${activityPath}.order`);
    if (!activityId || !officialCode || order == null) return null;
    ensureUnique(activityIds, activityId, issues, "DUPLICATE_ACTIVITY_ID", `${activityPath}.id`);

    if (!Array.isArray(activity.segments) || activity.segments.length === 0) {
      addIssue(issues, "error", "MISSING_SEGMENTS", `${activityPath}.segments`, "النشاط يجب أن يحتوي جزءًا زمنيًا واحدًا على الأقل.");
      return null;
    }
    const segments = activity.segments.map((segment, segmentIndex) => {
      const segmentPath = `${activityPath}.segments[${segmentIndex}]`;
      if (!isRecord(segment)) {
        addIssue(issues, "error", "INVALID_SEGMENT", segmentPath, "سجل الجزء الزمني غير صالح.");
        return null;
      }
      audit.segments += 1;
      const sourceId = requiredString(segment.id, issues, `${segmentPath}.id`);
      const segmentOrder = positiveNumber(segment.order, issues, `${segmentPath}.order`);
      const durationMinutes = positiveNumber(segment.durationMinutes, issues, `${segmentPath}.durationMinutes`);
      if (!sourceId || segmentOrder == null || durationMinutes == null) return null;
      const id = `${sessionId}/activity:${activityId}/segment:${sourceId}`;
      ensureUnique(segmentKeys, id, issues, "DUPLICATE_SEGMENT_KEY", `${segmentPath}.id`);
      return {
        id,
        type: "segment",
        sourceId,
        officialCode,
        title: stringOrEmpty(segment.title),
        method: stringOrEmpty(segment.method),
        order: segmentOrder,
        durationMinutes,
        sourcePage: numberOrZero(segment.sourcePage),
        timerEligible: !blocked,
      };
    }).filter(Boolean);

    return {
      id: `${sessionId}/activity:${activityId}`,
      sourceId: activityId,
      officialCode,
      title: stringOrEmpty(activity.title),
      order,
      sourcePage: numberOrZero(activity.sourcePage),
      segments,
    };
  }).filter(Boolean);

  const computedSegmentMinutes = activities.flatMap((activity) => activity.segments).reduce((sum, segment) => sum + segment.durationMinutes, 0);
  if (typeof rawSession.segmentSumMinutes === "number" && rawSession.segmentSumMinutes !== computedSegmentMinutes) {
    addIssue(issues, "error", "SESSION_SEGMENT_SUM_MISMATCH", sessionPath, "مجموع الأجزاء لا يطابق segmentSumMinutes.");
  }
  if (canonicalMinutes != null && canonicalMinutes !== computedSegmentMinutes) {
    addIssue(issues, "error", "SESSION_CANONICAL_SUM_MISMATCH", sessionPath, "مجموع الأجزاء لا يطابق زمن الجلسة Canonical.");
  }

  const embeddedBreaks = Array.isArray(rawSession.embeddedBreaks)
    ? rawSession.embeddedBreaks.map((item, index) =>
        buildEmbeddedBreak(item, sessionId, index, activities, issues, `${sessionPath}.embeddedBreaks[${index}]`),
      ).filter(Boolean)
    : [];
  if (!Array.isArray(rawSession.embeddedBreaks)) {
    addIssue(issues, "error", "MISSING_EMBEDDED_BREAKS", `${sessionPath}.embeddedBreaks`, "embeddedBreaks يجب أن تكون مصفوفة.");
  }

  const placedBreaks = embeddedBreaks.filter((item) => item.placementStatus === "resolved");
  const unplacedBreaks = embeddedBreaks.filter((item) => item.placementStatus === "unresolved");
  for (const item of unplacedBreaks) {
    addIssue(issues, "review", "UNRESOLVED_BREAK_PLACEMENT", item.id, item.reason || "موضع الاستراحة يحتاج اعتمادًا.");
  }
  if (blocked) {
    addIssue(issues, "review", "SESSION_BLOCKED", sessionId, "الجلسة غير قابلة للتشغيل حتى اعتماد مدتها Canonical.");
  }

  return {
    id: sessionId,
    order: sessionNumber,
    title: stringOrEmpty(rawSession.title),
    sourcePage: numberOrZero(rawSession.sourcePage),
    canonicalInstructionalMinutes: canonicalMinutes,
    canonicalStatus,
    timerEligible: !blocked,
    activities,
    placedBreaks,
    unplacedBreaks,
  };
}

/** @param {unknown} rawBreak @param {string} sessionId @param {number} index @param {any[]} activities @param {ValidationIssue[]} issues @param {string} path */
function buildEmbeddedBreak(rawBreak, sessionId, index, activities, issues, path) {
  if (!isRecord(rawBreak) || !isRecord(rawBreak.placement)) {
    addIssue(issues, "error", "INVALID_EMBEDDED_BREAK", path, "بيانات الاستراحة المضمّنة غير صالحة.");
    return null;
  }
  const duration = positiveNumber(rawBreak.canonicalDurationMinutes ?? rawBreak.durationMinutes, issues, `${path}.canonicalDurationMinutes`);
  if (duration == null) return null;
  const status = rawBreak.placement.status;
  if (status !== "resolved" && status !== "unresolved") {
    addIssue(issues, "error", "INVALID_BREAK_PLACEMENT_STATUS", `${path}.placement.status`, "حالة موضع الاستراحة غير معروفة.");
    return null;
  }
  const afterSegmentId = typeof rawBreak.placement.afterSegmentId === "string" ? rawBreak.placement.afterSegmentId : undefined;
  if (status === "resolved") {
    const sourceSegmentIds = new Set(activities.flatMap((activity) => activity.segments.map((segment) => segment.sourceId)));
    if (!afterSegmentId || !sourceSegmentIds.has(afterSegmentId)) {
      addIssue(issues, "error", "UNKNOWN_BREAK_ANCHOR", `${path}.placement.afterSegmentId`, "مرجع الجزء السابق للاستراحة غير موجود في الجلسة.");
    }
  }
  if (status === "unresolved" && afterSegmentId) {
    addIssue(issues, "error", "UNRESOLVED_BREAK_HAS_ANCHOR", path, "الاستراحة غير المحسومة لا يجوز أن تحمل موضعًا معتمدًا.");
  }

  return {
    id: `${sessionId}/embedded-break:${index + 1}`,
    type: "break",
    durationMinutes: duration,
    placementStatus: status,
    ...(afterSegmentId ? { afterSegmentId } : {}),
    ...(typeof rawBreak.placement.boundaryMinute === "number" ? { boundaryMinute: rawBreak.placement.boundaryMinute } : {}),
    ...(typeof rawBreak.placement.reason === "string" ? { reason: rawBreak.placement.reason } : {}),
    sourcePage: numberOrZero(rawBreak.sourcePage),
    timerEligible: status === "resolved",
  };
}

/** @param {unknown} rawBreak @param {string} dayId @param {number} index @param {ValidationIssue[]} issues @param {string} path */
function buildExternalBreak(rawBreak, dayId, index, issues, path) {
  if (!isRecord(rawBreak)) {
    addIssue(issues, "error", "INVALID_EXTERNAL_BREAK", path, "بيانات الاستراحة الخارجية غير صالحة.");
    return null;
  }
  const duration = positiveNumber(rawBreak.canonicalDurationMinutes ?? rawBreak.durationMinutes, issues, `${path}.canonicalDurationMinutes`);
  const afterSession = positiveNumber(rawBreak.afterSession, issues, `${path}.afterSession`);
  if (duration == null || afterSession == null) return null;
  return {
    id: `${dayId}/external-break:${index + 1}`,
    type: "break",
    afterSession,
    durationMinutes: duration,
    sourcePage: numberOrZero(rawBreak.sourcePage),
    timerEligible: true,
  };
}

/** @param {Record<string, any>} summary @param {ValidationIssue[]} issues */
function validateSummaryCounts(summary, issues) {
  const resolved = arrayLength(summary.resolved);
  const unresolved = arrayLength(summary.unresolved);
  compareCount(summary.resolvedCount, resolved, issues, "SUMMARY_RESOLVED_COUNT", "$.validationSummary.resolvedCount");
  compareCount(summary.unresolvedCount, unresolved, issues, "SUMMARY_UNRESOLVED_COUNT", "$.validationSummary.unresolvedCount");
  compareCount(summary.sourceAnomalyCount, resolved + unresolved, issues, "SUMMARY_ANOMALY_COUNT", "$.validationSummary.sourceAnomalyCount");
}

/** @param {unknown} theme @param {unknown} catalogTheme @param {ValidationIssue[]} issues @param {string} path */
function validateTheme(theme, catalogTheme, issues, path) {
  if (!isRecord(theme)) {
    addIssue(issues, "error", "INVALID_THEME", path, "سمة الحقيبة مفقودة أو غير صالحة.");
    return;
  }
  if (!isHexColor(theme.primary) || !isHexColor(theme.dark)) {
    addIssue(issues, "error", "INVALID_THEME_COLOR", path, "ألوان السمة يجب أن تكون HEX.");
  }
  if (!isRecord(catalogTheme)) {
    addIssue(issues, "error", "TRACK_THEME_NOT_FOUND", path, "لم توجد سمة المسار في themeCatalog.");
    return;
  }
  if (theme.primary !== catalogTheme.primary || theme.dark !== catalogTheme.dark) {
    addIssue(issues, "error", "PACKAGE_THEME_MISMATCH", path, "سمة الحقيبة لا تطابق سمة المسار المعتمدة.");
  }
}

/** @param {Set<string>} set @param {string} value @param {ValidationIssue[]} issues @param {string} code @param {string} path */
function ensureUnique(set, value, issues, code, path) {
  if (set.has(value)) addIssue(issues, "error", code, path, `المعرف مكرر: ${value}`);
  set.add(value);
}

/** @param {unknown} expected @param {number} actual @param {ValidationIssue[]} issues @param {string} code @param {string} path */
function compareCount(expected, actual, issues, code, path) {
  if (expected !== actual) addIssue(issues, "error", code, path, `القيمة المسجلة ${String(expected)} لا تطابق القيمة المحسوبة ${actual}.`);
}

/** @param {ValidationIssue[]} issues @param {import('../../data/types.js').IssueSeverity} severity @param {string} code @param {string} path @param {string} message */
function addIssue(issues, severity, code, path, message) {
  issues.push({ severity, code, path, message });
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

/** @param {unknown} value @param {ValidationIssue[]} issues @param {string} path */
function requiredString(value, issues, path) {
  if (typeof value !== "string" || value.trim() === "") {
    addIssue(issues, "error", "REQUIRED_STRING", path, "القيمة النصية مطلوبة.");
    return null;
  }
  return value;
}

/** @param {unknown} value @param {ValidationIssue[]} issues @param {string} path @param {boolean} [allowZero=false] */
function positiveNumber(value, issues, path, allowZero = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    addIssue(issues, "error", "INVALID_POSITIVE_NUMBER", path, "يلزم رقم موجب صالح.");
    return null;
  }
  return value;
}

/** @param {unknown} value @param {ValidationIssue[]} issues @param {string} path */
function nullablePositiveNumber(value, issues, path) {
  if (value === null) return null;
  return positiveNumber(value, issues, path);
}

/** @param {unknown} value */
function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

/** @param {unknown} value */
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** @param {string} namespace @param {string} value */
function makeKey(namespace, value) {
  return `${namespace}:${encodeURIComponent(value.normalize("NFC"))}`;
}

/** @param {unknown} value */
function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
