# ACR Template Guide

How to build an Accessibility Compliance Record (ACR) for a new client from **ACR Template.html**, and how the client portal completes it from the client's approvals.

The template is the Freshé ACR (Version 1.0, issued November 12, 2026) with Freshé's facts taken out. Its look, sections and wording are the house standard for every client. Don't restyle it per client.

---

## 1. The files

| File | What it is |
|---|---|
| `templates/acr/ACR Template.html` | The blank record. Copy it for each new client. Fonts (Inter) are built in, so the PDF carries them. |
| `templates/acr/ACR Template Guide.md` | This guide. |

The client's own ACR lives in the portal, not in the repo. Each published version is kept there as a PDF and an HTML file.

---

## 2. How a record moves from draft to published

1. **Baseline and remediation.** Run the baseline audit, fix the theme on a duplicate theme, publish it, and keep the dated remediation log.
2. **Approval packet.** Publish the Accessibility Statement and Footer packet to the client in the portal (see section 5). The client answers it there.
3. **Prepare the ACR draft.** Copy the template, fill in every blue `[[…]]` field (see section 4), and save it as `<Client> Accessibility Compliance Record Draft.html`.
4. **Upload the draft.** In the portal, open the client, then **Accessibility Compliance Record → Upload new draft**. If the portal warns that fill-ins are left or markers are missing, fix the file and upload it again.
5. **Make the approved changes live.** Publish the statement page, the footer and any other approved change on the live site. **No ACR is updated until the change is live.**
6. **Tick the work.** In **Approvals → Work to do**, tick each live item **Done and live**, then choose **Add to ACR update**. Leave the WCAG criterion blank and the conformance as "Not part of the conformance report", unless the item really is a WCAG fix. Anything typed in Team note is printed in the ACR.
7. **Build.** Click **Build updated ACR**. It downloads the record with every queued change merged in, as a PDF. Read it.
8. **Publish.** Click **Publish to client**. The PDF (fonts embedded) and the HTML both go to the client's Compliance files. The HTML becomes the next draft, and the queued items are marked as applied.
9. **Close the approval.** Close the packet in the portal so it moves to Past approvals. Delete any older draft PDF from the client's Compliance files.

Later updates repeat steps 5 to 8 against the newest draft. Don't upload the original draft again.

---

## 3. Version numbers

- A new record says **Version 1.0 draft**. The first Build issues it as **Version 1.0**, as the record's own cover memo promises.
- Each Build after that adds 0.1: 1.1, 1.2 and so on.
- Build updates the version and date on the cover and in every page footer, and adds a row to the record history table.

---

## 4. Preparing a new client's draft

### Two kinds of placeholder

| Looks like | Who fills it | When |
|---|---|---|
| Blue, dashed: `[[Client]]` | You, by hand | Before you upload the draft. None may remain. |
| Yellow: `[like this]` | Build, from the client's portal answers | Never by hand. Build fills it or clears it. |

When you replace a blue fill-in, type over the `[[…]]` text and leave the surrounding `<span class="fill">` in place. Build removes the highlight. Search the file for `[[` before you upload. The portal also warns about any you missed.

### Fill-ins to complete

- `[[Client]]` and `[[site]]`: use the store's trading name and its domain, for example `freshemeals.com`. Replace them everywhere, including the two inside the `<style>` block at the top. Those two print in the page header.
- `[[Month D, YYYY]]` next to `data-acr="date"` on the cover, and the matching one in the `<style>` block: use the date the draft is prepared. They must match exactly, because Build replaces that text in the page footer.
- `[[Account lead name]]`, `[[account lead email]]` and `[[phone]]` are the Accessrank account lead's details. Never use a home address.
- `[[page]]` in the contents table: render the draft once (open it in Chrome and print to PDF), then fill in the page numbers.
- Each section's facts (Sections 1 to 7, Exhibit list, Exhibit D and Appendix A) come from the baseline reports, the remediation log, the scan log and the engagement notes. Every fact is dated.
- Example rows (one per table) show the format. Copy the row once for each entry, then delete the example.
- Exhibit D must be the exact statement text the client is asked to approve. Its contact paragraph is already written three ways, for Options 1, 2 and 3. Leave all three in place, because Build keeps the one the client chooses. If the published wording ends up different from the draft, update Exhibit D before you build.
- The mailing address in Exhibit D is the client's business address, as it appears on their site.

### Writing rules

- Plain language. The client and their lawyer read this record. Explain or avoid technical terms.
- Never claim conformance before manual testing is complete and attested. Follow the "Language guidelines and disclaimer" table.
- Report only what was done and verified, with the date. A correction is a new row, never an edited old row.
- The Accessrank address in the disclaimer is city, state and phone only.

---

## 5. The approval packet must match the template

Build reads the client's answers by **item key** and **field label**. Build the packet from the Freshé "Accessibility Statement and Footer Approvals" report, with these keys:

| Key | Question | Answers Build expects |
|---|---|---|
| `statement` | The proposed accessibility statement | "Approved as is" / "Approved with the suggested changes below" |
| `contacts` | Who handles accessibility reports | Option labels that start "Option 1", "Option 2" or "Option 3". Fields labelled `… contact name`, `… contact email`, `… contact phone` and `Reply time in business days` |
| `footer` | The Accessrank footer addition | "Approved as shown" / "Approved with the changes listed below" / declined |

- Field labels can carry the client's name ("Acme contact email"). Build matches the ending, so "Contact email" in the template finds it.
- Phone numbers typed as bare digits are written out as (212) 555-0100.
- A comment that only repeats the signer's name is ignored.
- Clients never see WCAG rules in an approval packet. Packets cover design changes, the accessibility statement, the footer and contact details only.

---

## 6. Merge markers (what Build looks for)

Keep these attributes. Build changes only what they mark. Everything else prints as written.

| Marker | What Build does |
|---|---|
| `data-acr="version"` | Writes the new version number. "draft" is dropped when the record is issued. |
| `data-acr="date"` | Writes the date of the Build. |
| `data-acr="history"` | Adds a row to the record history table. |
| `data-acr="remediation-log"` with `data-acr-order="newest-first"` | Adds one row per approved change at the top of Section 2. |
| `data-acr="conformance"` | Adds a row to Section 3, only for changes ticked with a WCAG criterion. |
| `data-acr="approvals"` | Optional. Adds a row per change to a client-approvals table. |
| `data-acr="statement"` | Optional. Replaces the block with the statement wording taken from the approval report. The template doesn't use it. Exhibit D is written out in full instead. |
| `data-acr="appendix"` | Optional. Anything with no marked place goes in an "Updates" section just before this. |
| `data-acr-fill="KEY"` + `data-acr-format="…"` | Writes the answer into the text. Tokens: `{{@choice}}`, `{{@answer}}`, `{{@comment}}`, `{{@signer}}`, `{{@date}}` (approved), `{{@live}}` (done and live), a field label such as `{{Contact email}}`, or another item's answer such as `{{footer:@answer}}`. If an answer is missing, the yellow placeholder stays, so the line is never half-filled. |
| `data-acr-when="KEY"` / `data-acr-when="KEY~Option 3"` | Hidden until that item is applied (and, with `~`, only if its answer contains the text). Then it's shown. |
| `data-acr-until="KEY"` | Removed once that item is applied. Used for "pending" and "draft" wording. |
| `data-acr-placeholder="…"` on a yellow span | Whatever is still yellow at Build becomes this text, or the bracket text without brackets. No yellow reaches the published record. |
| `<template data-acr-row>` | The row pattern for a table above. Tokens include `{{date}}`, `{{dateShort}}`, `{{title}}`, `{{details}}`, `{{criterion}}`, `{{conformance}}`, `{{note}}`, `{{builtBy}}`. |
| `{{TOTAL}}` in the `@page` footer | Replaced with the real page count. |

---

## 7. Checklists

**Before uploading a draft**
- [ ] No `[[` left in the file (the portal warns if there are).
- [ ] Client name, domain and date also replaced in the `<style>` block.
- [ ] Contents page numbers filled in.
- [ ] Exhibit D matches the packet the client approves, word for word.
- [ ] File name: `<Client> Accessibility Compliance Record Draft.html` (capitalized words, spaces, no underscores).

**Before ticking items in Work to do**
- [ ] The change is live on the published theme, not just in a draft theme.
- [ ] The statement page is visible and its footer links work.

**Before publishing**
- [ ] The built PDF has no yellow placeholders and no `[[`.
- [ ] Exhibit D matches the live statement page.
- [ ] The version and date on the cover and in the footer are right.

**After publishing**
- [ ] Close the approval packet.
- [ ] Remove superseded drafts from the client's Compliance files.

---

## 8. If something looks wrong

| Problem | Cause and fix |
|---|---|
| Build gives a list of changes, not the merged record | The newest draft isn't an `.html` file. Upload the HTML draft. |
| Changes appear in an "Updates in version…" section | The draft has no `data-acr="remediation-log"` marker. Use the template. |
| A yellow placeholder became "not given in the approval" | The client left that field blank. Get the answer, then upload a corrected draft or note it in the next update. |
| The wrong contact paragraph shows | The `contacts` answer doesn't contain "Option 1", "Option 2" or "Option 3". Fix the packet's option labels. |
| A field shows blank in the merged text | The packet's field label doesn't end with the label the template uses ("contact email" and so on). |
| A section sits on the wrong page in the PDF | Re-render the draft and update the contents page numbers. |
