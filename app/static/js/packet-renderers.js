function packetEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function packetValue(value, fallback='—') {
  return value === null || value === undefined || value === '' ? fallback : packetEscape(value);
}

function packetCoverHtml({businessName, title, client, project=null, generatedAt, admin=false}) {
  return `<header class="packet-cover">
    <div class="packet-cover-heading"><div><p class="packet-business-name">${packetEscape(businessName || 'Forged Systems LLC')}</p><h1>${packetEscape(title)}</h1></div>${admin ? '<strong class="packet-admin-label">INTERNAL / ADMIN COPY</strong>' : ''}</div>
    <div class="packet-cover-grid">
      <div><strong>Client</strong><span>${packetValue(client?.name)}</span></div>
      ${project ? `<div><strong>Project</strong><span>${packetValue(project.name)}</span></div><div><strong>Status</strong><span>${packetValue(project.status)}</span></div><div><strong>Site</strong><span>${packetValue(project.site_address)}</span></div><div><strong>Start Date</strong><span>${packetValue(project.start_date)}</span></div><div><strong>Completed Date</strong><span>${packetValue(project.completed_date)}</span></div>` : ''}
      <div><strong>Generated</strong><span>${packetValue(generatedAt)}</span></div>
    </div>
  </header>`;
}

export function projectClientPacketHtml({businessName, client, project, quoteSections=[], invoiceSections=[], generatedAt}) {
  const documents = [...quoteSections, ...invoiceSections];
  return `<main class="packet packet-client-copy" data-packet-type="project-client-copy">
    ${packetCoverHtml({businessName, title:'Project Packet — Client Copy', client, project, generatedAt})}
    ${documents.length ? documents.join('') : '<section class="packet-empty"><p>No Quotes or Invoices are currently associated with this Project.</p></section>'}
  </main>`;
}

export function projectAdminGroupHtml({businessName, client, project, generatedAt, includeCover=false, summaryHtml='', quoteSections=[], invoiceSections=[], laborHtml='', ledgerHtml='', receiptSections=[]}) {
  const heading = includeCover
    ? packetCoverHtml({businessName, title:'Project Packet — Admin Copy', client, project, generatedAt, admin:true})
    : `<header class="packet-project-heading page-break"><p class="packet-kicker">Client Project</p><h2>Project: ${packetValue(project?.name)}</h2><p>${packetValue(project?.status)} · ${packetValue(project?.site_address)}</p></header>`;
  return `<section class="packet-project-group" data-project-packet-id="${packetValue(project?.id, '')}">
    ${heading}${summaryHtml}${quoteSections.join('')}${invoiceSections.join('')}${laborHtml}${ledgerHtml}${receiptSections.join('')}
  </section>`;
}

export function clientAdminPacketHtml({businessName, client, generatedAt, summaryHtml='', projectSections=[], unassignedHtml=''}) {
  return `<main class="packet packet-admin-copy" data-packet-type="client-admin-copy">
    ${packetCoverHtml({businessName, title:'Client Packet — Admin Copy', client, generatedAt, admin:true})}
    ${summaryHtml}${projectSections.join('')}${unassignedHtml}
  </main>`;
}
