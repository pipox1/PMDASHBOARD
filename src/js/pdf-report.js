/**
 * PDF Report Generator for PM Dashboard
 * Uses jsPDF + AutoTable - Includes Subprojects
 */
var pdfReport = null;

(function() {

function PDFReport() {
  this.colors = {
    orange: [244, 126, 37],
    dark: [45, 49, 66],
    success: [76, 175, 80],
    warning: [255, 193, 7],
    danger: [244, 67, 54],
    info: [33, 150, 243],
    gray: [107, 114, 128],
    lightGray: [229, 231, 235],
    white: [255, 255, 255],
    bgLight: [245, 246, 250],
    subBg: [255, 248, 240],
    subOrange: [255, 224, 192]
  };
}

PDFReport.prototype.generate = function(pmData, companyName) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF('p', 'mm', 'letter');
  var pageWidth = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin = 15;
  var contentWidth = pageWidth - (margin * 2);
  var y = margin;

  // Get subproject groups from dashboard
  var groups = { byPm: {}, byProject: {} };
  if (dashboard && dashboard.getSubprojectGroups) {
    groups = dashboard.getSubprojectGroups();
  }

  // ========== HEADER ==========
  y = this.drawHeader(doc, y, pageWidth, margin, companyName);

  // ========== SUMMARY ==========
  y = this.drawSummary(doc, y, margin, contentWidth, pmData, groups.byPm);

  // ========== PM SECTIONS ==========
  var pmList = [];
  var keys = Object.keys(pmData);
  for (var k = 0; k < keys.length; k++) {
    pmList.push(pmData[keys[k]]);
  }
  pmList.sort(function(a, b) { return a.name.localeCompare(b.name); });

  for (var p = 0; p < pmList.length; p++) {
    var pm = pmList[p];

    if (y > pageHeight - 60) {
      doc.addPage();
      y = margin;
      y = this.drawPageHeader(doc, y, pageWidth, margin);
    }

    y = this.drawPMSection(doc, y, margin, contentWidth, pm, pageHeight, groups);
  }

  // ========== FOOTER ON ALL PAGES ==========
  var totalPages = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= totalPages; pg++) {
    doc.setPage(pg);
    this.drawFooter(doc, pageHeight, pageWidth, margin, pg, totalPages);
  }

  var dateStr = new Date().toISOString().split('T')[0];
  doc.save('PM_Dashboard_Report_' + dateStr + '.pdf');
};

PDFReport.prototype.drawHeader = function(doc, y, pageWidth, margin, companyName) {
  doc.setFillColor(this.colors.dark[0], this.colors.dark[1], this.colors.dark[2]);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setFillColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.rect(0, 28, pageWidth, 2, 'F');

  doc.setTextColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('PROCORE', margin, 12);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('PM Dashboard Report', margin + 42, 12);

  doc.setFontSize(9);
  doc.setTextColor(200, 200, 200);
  doc.text(companyName || 'Company', margin, 22);

  var now = new Date();
  var dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.setFontSize(9);
  doc.text(dateStr, pageWidth - margin, 22, { align: 'right' });

  return 38;
};

PDFReport.prototype.drawPageHeader = function(doc, y, pageWidth, margin) {
  doc.setFillColor(this.colors.bgLight[0], this.colors.bgLight[1], this.colors.bgLight[2]);
  doc.rect(0, 0, pageWidth, 12, 'F');
  doc.setFillColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.rect(0, 12, pageWidth, 0.5, 'F');

  doc.setTextColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('PROCORE', margin, 8);

  doc.setTextColor(this.colors.gray[0], this.colors.gray[1], this.colors.gray[2]);
  doc.setFont('helvetica', 'normal');
  doc.text('PM Dashboard Report', margin + 25, 8);

  return 18;
};

PDFReport.prototype.drawSummary = function(doc, y, margin, contentWidth, pmData, subsByPm) {
  var pmList = [];
  var keys = Object.keys(pmData);
  for (var k = 0; k < keys.length; k++) pmList.push(pmData[keys[k]]);

  var totalProjects = 0, activeProjects = 0, totalProgress = 0, totalItems = 0;
  for (var i = 0; i < pmList.length; i++) {
    var pmSubs = (subsByPm && subsByPm[String(pmList[i].id)]) ? subsByPm[String(pmList[i].id)] : [];
    totalProjects += pmList[i].projects.length + pmSubs.length;
    totalItems += pmList[i].projects.length + pmSubs.length;
    for (var j = 0; j < pmList[i].projects.length; j++) {
      if (pmList[i].projects[j].status === 'Active') activeProjects++;
      totalProgress += pmList[i].projects[j].progressPercent;
    }
    for (var sj = 0; sj < pmSubs.length; sj++) {
      var spStage = (pmSubs[sj].stage || '').toLowerCase();
      if (spStage.indexOf('ejecuc') > -1 || spStage.indexOf('construc') > -1) activeProjects++;
      totalProgress += pmSubs[sj].totalTasks > 0 ? Math.round((pmSubs[sj].completedTasks / pmSubs[sj].totalTasks) * 100) : 0;
    }
  }
  var avgProgress = totalItems > 0 ? Math.round(totalProgress / totalItems) : 0;

  doc.setTextColor(this.colors.dark[0], this.colors.dark[1], this.colors.dark[2]);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', margin, y);
  y += 7;

  var boxWidth = contentWidth / 4 - 2;
  var boxHeight = 18;
  var summaryData = [
    { label: 'Total Projects', value: totalProjects.toString(), color: this.colors.orange },
    { label: 'Active', value: activeProjects.toString(), color: this.colors.success },
    { label: 'Project Managers', value: pmList.length.toString(), color: this.colors.info },
    { label: 'Avg. Progress', value: avgProgress + '%', color: this.colors.warning }
  ];

  for (var s = 0; s < summaryData.length; s++) {
    var bx = margin + (s * (boxWidth + 2.5));
    var item = summaryData[s];

    doc.setFillColor(this.colors.bgLight[0], this.colors.bgLight[1], this.colors.bgLight[2]);
    doc.roundedRect(bx, y, boxWidth, boxHeight, 2, 2, 'F');

    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.rect(bx, y, 2, boxHeight, 'F');

    doc.setTextColor(this.colors.dark[0], this.colors.dark[1], this.colors.dark[2]);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(item.value, bx + 8, y + 8);

    doc.setTextColor(this.colors.gray[0], this.colors.gray[1], this.colors.gray[2]);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(item.label.toUpperCase(), bx + 8, y + 14);
  }

  y += boxHeight + 8;

  doc.setDrawColor(this.colors.lightGray[0], this.colors.lightGray[1], this.colors.lightGray[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + contentWidth, y);
  y += 6;

  return y;
};

PDFReport.prototype.drawPMSection = function(doc, y, margin, contentWidth, pm, pageHeight, groups) {
  var subsByPm = groups.byPm || {};
  var subsByProject = groups.byProject || {};
  var pmSubs = subsByPm[String(pm.id)] || [];
  var pmTotalItems = pm.projects.length + pmSubs.length;

  var pmActive = 0, pmProg = 0;
  var pmTotalTasks = pm.totalTasks;
  var pmCompTasks = pm.completedTasks;

  for (var q = 0; q < pm.projects.length; q++) {
    if (pm.projects[q].status === 'Active') pmActive++;
    pmProg += pm.projects[q].progressPercent;
  }
  for (var sq = 0; sq < pmSubs.length; sq++) {
    var spStage = (pmSubs[sq].stage || '').toLowerCase();
    if (spStage.indexOf('ejecuc') > -1 || spStage.indexOf('construc') > -1) pmActive++;
    pmProg += pmSubs[sq].totalTasks > 0 ? Math.round((pmSubs[sq].completedTasks / pmSubs[sq].totalTasks) * 100) : 0;
    pmTotalTasks += pmSubs[sq].totalTasks;
    pmCompTasks += pmSubs[sq].completedTasks;
  }
  var pmAvg = pmTotalItems > 0 ? Math.round(pmProg / pmTotalItems) : 0;

  // PM Header
  doc.setFillColor(this.colors.dark[0], this.colors.dark[1], this.colors.dark[2]);
  doc.roundedRect(margin, y, contentWidth, 14, 2, 2, 'F');

  doc.setFillColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.circle(margin + 8, y + 7, 5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text(pm.initials, margin + 8, y + 9, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(pm.name, margin + 16, y + 6);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 200, 200);
  doc.text(pm.email || '', margin + 16, y + 11);

  doc.setTextColor(this.colors.orange[0], this.colors.orange[1], this.colors.orange[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(pmAvg + '%', margin + contentWidth - 5, y + 6, { align: 'right' });

  doc.setTextColor(200, 200, 200);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(pmTotalItems + ' projects | ' + pmActive + ' active', margin + contentWidth - 5, y + 11, { align: 'right' });

  y += 18;

  // Build table data with subprojects
  var tableData = [];
  pm.projects.sort(function(a, b) {
    if (a.status === 'Active' && b.status !== 'Active') return -1;
    if (a.status !== 'Active' && b.status === 'Active') return 1;
    return b.progressPercent - a.progressPercent;
  });

  for (var r = 0; r < pm.projects.length; r++) {
    var proj = pm.projects[r];

    // Main project row
    tableData.push({
      type: 'project',
      cells: [
        (proj.number ? '#' + proj.number + '  ' : '') + proj.name,
        proj.stage,
        proj.status,
        proj.completedTasks + '/' + proj.totalTasks,
        proj.progressPercent + '%'
      ]
    });

    // Subprojects for this project
    var projSubs = subsByProject[String(proj.id)] || [];
    for (var s = 0; s < projSubs.length; s++) {
      var spd = projSubs[s];
      var spProg = spd.totalTasks > 0 ? Math.round((spd.completedTasks / spd.totalTasks) * 100) : 0;
      var spStageLower = (spd.stage || '').toLowerCase();
      var spStatus = 'Active';
      if (spStageLower.indexOf('terminad') > -1 || spStageLower.indexOf('garant') > -1) spStatus = 'Completed';

      tableData.push({
        type: 'subproject',
        cells: [
          '  ↳ ' + (spd.number ? '#' + spd.number + ' ' : '') + spd.name + ' [SUB]',
          spd.stage,
          spStatus,
          spd.completedTasks + '/' + spd.totalTasks,
          spProg + '%'
        ]
      });
    }
  }

  if (tableData.length > 0) {
    var self = this;
    var bodyData = [];
    var rowTypes = [];
    for (var t = 0; t < tableData.length; t++) {
      bodyData.push(tableData[t].cells);
      rowTypes.push(tableData[t].type);
    }

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Project', 'Stage', 'Status', 'Tasks', 'Progress']],
      body: bodyData,
      styles: {
        fontSize: 7,
        cellPadding: 2,
        lineColor: [229, 231, 235],
        lineWidth: 0.1,
        font: 'helvetica'
      },
      headStyles: {
        fillColor: [245, 246, 250],
        textColor: [107, 114, 128],
        fontStyle: 'bold',
        fontSize: 7
      },
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 30 },
        2: { cellWidth: 20 },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }
      },
      didParseCell: function(data) {
        if (data.section === 'body') {
          var rType = rowTypes[data.row.index];

          // Subproject row styling
          if (rType === 'subproject') {
            data.cell.styles.fillColor = [255, 248, 240];
            if (data.column.index === 0) {
              data.cell.styles.textColor = self.colors.orange;
              data.cell.styles.fontStyle = 'italic';
            }
          }

          // Status column color
          if (data.column.index === 2) {
            var status = data.cell.raw;
            if (status === 'Active') data.cell.styles.textColor = self.colors.success;
            else if (status === 'Completed') data.cell.styles.textColor = self.colors.info;
            else if (status === 'Overdue') data.cell.styles.textColor = self.colors.danger;
            else if (status === 'Not Started') data.cell.styles.textColor = self.colors.gray;
          }

          // Progress column color
          if (data.column.index === 4) {
            var pct = parseInt(data.cell.raw);
            if (pct >= 75) data.cell.styles.textColor = self.colors.success;
            else if (pct >= 50) data.cell.styles.textColor = self.colors.orange;
            else if (pct >= 25) data.cell.styles.textColor = [255, 193, 7];
            else data.cell.styles.textColor = self.colors.danger;
          }
        }
      },
      alternateRowStyles: {
        fillColor: [250, 251, 252]
      },
      didDrawCell: function(data) {
        // Draw orange left border for subproject rows
        if (data.section === 'body') {
          var rType = rowTypes[data.row.index];
          if (rType === 'subproject' && data.column.index === 0) {
            doc.setFillColor(self.colors.orange[0], self.colors.orange[1], self.colors.orange[2]);
            doc.rect(data.cell.x, data.cell.y, 0.8, data.cell.height, 'F');
          }
        }
      }
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  return y;
};

PDFReport.prototype.drawFooter = function(doc, pageHeight, pageWidth, margin, currentPage, totalPages) {
  var footerY = pageHeight - 8;

  doc.setDrawColor(this.colors.lightGray[0], this.colors.lightGray[1], this.colors.lightGray[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);

  doc.setTextColor(this.colors.gray[0], this.colors.gray[1], this.colors.gray[2]);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated by Procore PM Dashboard', margin, footerY);

  var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.text(dateStr, pageWidth / 2, footerY, { align: 'center' });

  doc.text('Page ' + currentPage + ' of ' + totalPages, pageWidth - margin, footerY, { align: 'right' });
};

pdfReport = new PDFReport();
console.log('[PDFReport] Module loaded with subprojects support.');

})();
