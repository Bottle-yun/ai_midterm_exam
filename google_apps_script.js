function doGet(e) {
  try {
    // 1. 파라미터로 데이터 저장 요청이 들어온 경우 (GET 방식 저장 - CORS/Redirect 문제 100% 없음)
    if (e && e.parameter && (e.parameter.name || e.parameter.action === "save")) {
      return handleSave(e.parameter);
    }

    // 2. 랭킹 데이터 조회 요청
    return handleGetScores();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var params = {};
    if (e && e.postData && e.postData.contents) {
      try {
        params = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        params = e.parameter || {};
      }
    } else if (e && e.parameter) {
      params = e.parameter;
    }

    return handleSave(params);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      result: "error",
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleSave(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var name = params.name || "";
  var finishTime = params.finishtime || params.timeStr || "";
  var timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  if (!name || !finishTime) {
    return ContentService.createTextOutput(JSON.stringify({
      result: "error",
      message: "Missing name or finishtime"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 첫 번째 행 헤더 확인
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 3)).getValues()[0];
  var tsCol = -1, nameCol = -1, ftCol = -1;

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h === "timestamp") tsCol = i + 1;
    if (h === "name") nameCol = i + 1;
    if (h === "finishtime") ftCol = i + 1;
  }

  if (tsCol === -1 || nameCol === -1 || ftCol === -1) {
    sheet.getRange(1, 1, 1, 3).setValues([["timestamp", "name", "finishtime"]]);
    tsCol = 1;
    nameCol = 2;
    ftCol = 3;
  }

  var nextRow = sheet.getLastRow() + 1;
  var maxCol = Math.max(tsCol, nameCol, ftCol);
  var rowData = [];
  for (var c = 0; c < maxCol; c++) rowData.push("");

  rowData[tsCol - 1] = timestamp;
  rowData[nameCol - 1] = name;
  rowData[ftCol - 1] = finishTime;

  sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);

  return ContentService.createTextOutput(JSON.stringify({
    result: "success",
    saved: { timestamp: timestamp, name: name, finishtime: finishTime }
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetScores() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return ContentService.createTextOutput(JSON.stringify([]))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var headers = data[0];
  var tsCol = 0, nameCol = 1, ftCol = 2;

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h === "timestamp") tsCol = i;
    if (h === "name") nameCol = i;
    if (h === "finishtime") ftCol = i;
  }

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = row[nameCol];
    var finishTime = row[ftCol];
    var timestamp = row[tsCol];

    if (!name || !finishTime) continue;

    var ftStr = "";
    if (finishTime instanceof Date) {
      var mm = String(finishTime.getMinutes()).padStart(2, "0");
      var ss = String(finishTime.getSeconds()).padStart(2, "0");
      ftStr = mm + ":" + ss;
      totalSec = finishTime.getMinutes() * 60 + finishTime.getSeconds();
    } else {
      ftStr = String(finishTime).trim();
      var match = ftStr.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (match) {
        var m = parseInt(match[2], 10);
        var s = parseInt(match[3], 10);
        ftStr = (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
        totalSec = m * 60 + s;
      } else if (ftStr.indexOf(":") !== -1) {
        var parts = ftStr.split(":");
        totalSec = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      } else if (!isNaN(Number(ftStr))) {
        totalSec = Number(ftStr);
      }
    }

    rows.push({
      name: String(name),
      timeStr: ftStr,
      totalSeconds: totalSec,
      date: String(timestamp)
    });
  }

  // 완료 시간 기준 빠른 순 정렬
  rows.sort(function(a, b) {
    return a.totalSeconds - b.totalSeconds;
  });

  return ContentService.createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}
