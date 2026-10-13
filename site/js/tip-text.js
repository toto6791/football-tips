/*
 * Превежда прогнозата от английски на български, когато е от познат вид.
 *   „Home win Arsenal FC - Tip 1“  →  код „1“, текст „Победа за Arsenal FC“
 * Ако видът е непознат, показва оригиналния текст.
 * Нови преводи се добавят в TIP_PATTERNS.
 */

var TIP_PATTERNS = [
  // [търсене, превод]  ($1, $2 … са частите в скоби от търсенето)
  [/^home win (?:for )?(.+)$/i, "Победа за $1"],
  [/^away win (?:for )?(.+)$/i, "Победа за $1"],
  [/^(?:the )?draw$/i, "Равенство"],
  [/^double chance (.+)$/i, "Двоен шанс: $1"],
  [/^both teams to score\s*-?\s*yes$/i, "И двата отбора вкарват"],
  [/^both teams to score\s*-?\s*no$/i, "Поне един отбор не вкарва"],
  [/^(?:btts|gg)\W*yes$/i, "И двата отбора вкарват"],
  [/^(?:btts|ng)\W*no$/i, "Поне един отбор не вкарва"],
  [/^over ([\d.,]+)(?: goals)?$/i, "Над $1 гола"],
  [/^under ([\d.,]+)(?: goals)?$/i, "Под $1 гола"],
  [/^(.+) to win$/i, "Победа за $1"],
];

// Връща { code: "1", text: "Победа за Arsenal FC", original: "…" }
function describeTip(tip) {
  var original = String(tip || "").trim();
  if (!original) return null;

  // кодът след „Tip“ накрая: „… - Tip 1“, „… - Tip X2“, „… - Tip Over 2.5“
  var code = "";
  var main = original;
  var m = original.match(/^(.*?)\s*[-–]\s*Tip\s+(.+)$/i);
  if (m) {
    main = m[1].trim();
    code = m[2].trim();
  }

  // „Both teams to score - Tip Yes“: „Yes/No“ е част от прогнозата
  if (/^(yes|no)$/i.test(code)) {
    main = main + " - " + code;
    code = /^yes$/i.test(code) ? "ГГ" : "НГ"; // гол-гол / няма гол-гол
  }

  // „Over 2.5“ → „+2.5“, „Under 2.5“ → „−2.5“, за да се събере във фишчето
  code = code.replace(/^over\s*/i, "+").replace(/^under\s*/i, "−");

  var text = main;
  for (var i = 0; i < TIP_PATTERNS.length; i++) {
    if (TIP_PATTERNS[i][0].test(main)) {
      text = main.replace(TIP_PATTERNS[i][0], TIP_PATTERNS[i][1]);
      break;
    }
  }

  // ако няма код, опитваме да го познаем
  if (!code) {
    if (/^home win/i.test(main)) code = "1";
    else if (/^away win/i.test(main)) code = "2";
    else if (/^(the )?draw$/i.test(main)) code = "X";
  }
  if (code.length > 5) code = ""; // дълъг код не се събира във фишчето

  return { code: code, text: text, original: original };
}
