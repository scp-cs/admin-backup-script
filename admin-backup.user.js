/*
 * Wikidot admin panel backup userscript
 * Modified for SCP-CS internal use, for original script visit https://github.com/scpwiki/admin-backup-script
 *
 * Contact: https://www.wikidot.com/account/messages#/new/4598089
 */

// Data processing

function parseHtml(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

function parseUserElement(element) {
  if (element.classList.contains('deleted')) {
    // 'span.printuser' with "deleted" class -> data-id user ID int
    const field = element.getAttribute('data-id');
    return parseInt(field);
  } else {
    // 'span.printuser a' element -> user ID int
    const anchor = element.querySelector('a');
    const regex = /WIKIDOT\.page\.listeners\.userInfo\((\d+)\)/;
    const value = anchor.getAttribute('onclick');
    const result = value.match(regex)[1];
    return parseInt(result);
  }
}

function parseDateElement(element) {
  // odate element -> timestamp int
  for (const klass of element.classList) {
    if (klass.startsWith('time_')) {
      return parseInt(klass.substring(5));
    }
  }
  throw new Error('Unable to find timestamp in odate element');
}

function parseRating(value) {
  // Special case
  if (!value) {
    return { enable: 'default' };
  }

  // Example strings:
  // - draP (disabled)
  // - raP  (default/inherited)
  // - ervS (registered, visible votes, five-star)
  // - ervM (registered, visible votes, plus/minus)
  // - eraM (registered, hidden votes, plus/minus)
  // - emvP (site members, visible votes, plus-only)
  // - emaP (site members, hidden votes, plus-only)

  // Overall status
  //   d - disabled
  //   e - enabled
  //   If neither, then 'default'
  //   Always the first character
  let enable;
  switch (value[0]) {
    case 'e':
      enable = true;
      break;
    case 'd':
      enable = false;
      break;
    default: // lol
      enable = 'default';
  }

  // Eligible voters
  //   r - registered wikidot users
  //   m - site members
  let eligibility;
  if (value.includes('r')) {
    eligibility = 'registered';
  } else if (value.includes('m')) {
    eligibility = 'members';
  } else {
    throw new Error(`Invalid vote eligibility in spec str: ${value}`);
  }

  // Vote visibility
  //   a - anonymous
  //   v - visible
  const visibility = value.includes('v');

  // Vote type
  //   S - five-star
  //   M - plus/minus
  //   P - plus only
  let voteType;
  if (value.includes('S')) {
    voteType = 'fivestar';
  } else if (value.includes('M')) {
    voteType = 'plusminus';
  } else if (value.includes('P')) {
    voteType = 'plusonly';
  } else {
    console.warn(`Using 'plusonly' as default rating (no capital letter in '${value}')`);
    voteType = 'plusonly';
  }

  return { enable, eligibility, visibility, voteType };
}

function parsePagePermissions(enable, value) {
  // Example strings:
  // - v:armo;e:m;c:m;m:m;d:m;a:m;r:m;z:m;o:rm
  // - v:armo;c:;e:;m:;d:;a:;r:;z:;o:
  // - v:arm;e:;c:;m:;d:;a:;r:;z:;o:
  // - v:armo;c:;e:arm;m:rm;d:rm;a:m;r:o;z:o;o:

  if (value === null) {
    return null;
  }

  // Permission action:
  //   v - View pages
  //   c - Create pages
  //   e - Edit pages
  //   m - Move pages
  //   d - Delete pages
  //   a - Add files
  //   r - Rename files
  //   z - Replace, move, and delete files
  //   o - Show page options

  function parseAction(value) {
    switch (value) {
      case 'v': return 'viewPages';
      case 'c': return 'createPages';
      case 'e': return 'editPages';
      case 'm': return 'movePages';
      case 'd': return 'deletePages';
      case 'a': return 'uploadFiles';
      case 'r': return 'renameFiles';
      case 'z': return 'replaceDeleteFiles';
      case 'o': return 'showPageOptions';
    }
  }

  // User scopes:
  //   a - Anonymous users (no account)
  //   r - Registered users (has account)
  //   m - Site members
  //   o - Page creators ("owners"), regardless of the above

  function parseScope(value) {
    const anonymous = value.includes('a');
    const registered = value.includes('r');
    const members = value.includes('m');
    const pageCreators = value.includes('o');
    return { anonymous, registered, members, pageCreators };
  }

  // Parse each permission group

  const permissions = { enable };
  for (const group of value.split(';')) {
    const [perm, scope] = group.split(':');
    const action = parseAction(perm);
    const options = parseScope(scope);
    permissions[action] = options;
  }

  return permissions;
}

function parseForumPermissions(value) {
  // Example strings:
  // - t:;p:;e:;s:
  // - t:;p:m;e:o;s:
  // - t:m;p:rm;e:arm;s:

  if (value === null) {
    return null;
  }

  // Permission action:
  //   t - Create new threads
  //   p - Add posts to existing threads
  //   e - Edit posts (and thread metadata)
  //   s - Split threads (unused)

  function parseAction(value) {
    switch (value) {
      case 't': return 'createThreads';
      case 'p': return 'createPosts';
      case 'e': return 'editPosts';
      case 's': return undefined;
    }
  }

  // User scopes:
  //   a - Anonymous users (no account)
  //   r - Registered users (has account)
  //   m - Site members
  //   o - Thread creators ("owners"), regardless of the above

  function parseScope(value) {
    const anonymous = value.includes('a');
    const registered = value.includes('r');
    const members = value.includes('m');
    const threadCreators = value.includes('o');
    return { anonymous, registered, members, threadCreators };
  }

  // Parse each permission group
  const permissions = {};
  for (const group of value.split(';')) {
    const [perm, scope] = group.split(':');
    const action = parseAction(perm);
    const options = parseScope(scope);
    if (action) {
      permissions[action] = options;
    }
  }
  return permissions;
}

async function requestModule(moduleName, params=null) {
  console.debug('Making an AJAX module request', moduleName, params);
  const result = await new Promise((resolve) => {
    OZONE.ajax.requestModule(moduleName, params, resolve);
  });
  if (result['status'] !== 'ok') {
    throw new Error(`${moduleName} request failed`);
  }
  return result;
}

async function requestModuleHtml(moduleName, params=null) {
  const result = await requestModule(moduleName, params);
  return parseHtml(result['body']);
}

async function requestModuleHtmlPro(moduleName, params=null) {
  const result = await requestModule(moduleName, params);
  const html = result['body'];
  if (html.includes('http://www.wikidot.com/account/upgrade')) {
    console.warn(`Module ${moduleName} yielded feature unavailable (needs paid plan)`);
    return null;
  }

  return parseHtml(html);
}

function promptFileDownload(filename, blob) {
  const link = document.createElement('a');
  link.id = 'backup-download-object';
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click()
}

async function createZip(files) {
  console.info('Building output ZIP');
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import('https://cdn.jsdelivr.net/npm/@zip.js/zip.js/index.js');

  const zipFileWriter = new BlobWriter();
  const zipWriter = new ZipWriter(zipFileWriter);
  for (const file of files) {
    const [filename, data] = file;

    if (data instanceof Blob) {
      const reader = new BlobReader(data);
      await zipWriter.add(filename, reader);
    } else if (typeof data === 'object') {
      const json = JSON.stringify(data);
      const reader = new TextReader(json);
      await zipWriter.add(filename, reader);
    } else {
      throw new Error(`No handling for data object: ${data}`);
    }
  }

  await zipWriter.close();
  return zipFileWriter.getData();
}

// Backup tasks

async function fetchBasicInfo() {
  console.info('Fetching basic site information');

  // From variables
  const id = WIKIREQUEST.info.siteId;
  const slug = WIKIREQUEST.info.domain.replace(/\.wikidot\.com$/, '');
  // ^ This is verified to always be the *.wikidot.com domain
  const lang = WIKIREQUEST.info.lang;

  // From the 'general module'
  const html = await requestModuleHtml('managesite/ManageSiteGeneralModule');
  const description = html.getElementById('site-description-field').value;
  const textFields = html.querySelectorAll('.controls input');
  let name, tagline, homePage, welcomePage;
  switch (textFields.length) {
    case 5:
      // first item is the site slug, skip it
      name = textFields[1].value;
      tagline = textFields[2].value;
      homePage = textFields[3].value;
      welcomePage = textFields[4].value;
      break;
    case 4:
      // normal distribution
      name = textFields[0].value;
      tagline = textFields[1].value;
      homePage = textFields[2].value;
      welcomePage = textFields[3].value;
      break;
    default:
    throw new Error(`Unexpected number of text fields for general site info: ${textFields.length} (wanted 4 or 5)`);
  }

  return {
    dumpGeneratedAt: new Date().toISOString(), // why not, might come in handy
    id,
    slug,
    lang,
    description,
    name,
    tagline,
    homePage,
    welcomePage,
  };
}

async function fetchDomainSettings() {
  console.info('Fetching domain settings');
  const html = await requestModuleHtml('managesite/ManageSiteDomainModule');
  const customDomain = html.getElementById('sm-domain-field').value || null;
  const customDomainOnly = html.getElementById('sm-domain-default').checked;
  const redirectElements = html.querySelectorAll('#sm-redirects-box input');
  const extraDomains = [];
  for (const redirectElement of redirectElements) {
    if (redirectElement.value) {
      extraDomains.push(redirectElement.value);
    }
  }

  return {
    customDomain,
    customDomainOnly,
    extraDomains,
  };
}

async function fetchToolbarSettings() {
  console.info('Fetching toolbar settings');
  const html = await requestModuleHtml('managesite/ManageSiteToolbarsModule');
  const showTop = html.getElementById('sm-show-toolbar-input1').checked;
  const showBottom = html.getElementById('sm-show-toolbar-input2').checked;
  const promoteSite = html.getElementById('sm-promote').checked;
  return { showTop, showBottom, promoteSite };
}

async function fetchUserProfileSettings() {
  console.info('Fetching user profile settings');
  const html = await requestModuleHtmlPro('managesite/ManageSiteProfilePagesModule');
  if (!html) {
    return null;
  }

  const enable = html.getElementById('sm-profile-pages-form-enable').checked;
  const category = html.querySelector('input[name=category]').value;
  const currentTag = html.querySelector('input[name=tag_current]').value;
  const formerTag = html.querySelector('input[name=tag_former]').value;
  const usePopup = html.querySelector('input[name=popup]').checked;
  return { enable, category, currentTag, formerTag, usePopup };
}

async function fetchCustomFooter() {
  console.info('Fetching custom footer settings');
  const html = await requestModuleHtmlPro('managesite/ManageSiteCustomFooterModule');
  if (!html) {
    return { enable: false };
  }

  const enable = html.getElementById('sm-use-custom-footer').checked;
  const wikitext = html.getElementById('sm-cutsom-footer-input').innerText;
  return { enable, wikitext };
}

async function fetchAccessPolicy() {
  console.info('Fetching access policy');
  const html = await requestModuleHtml('managesite/ManageSiteAccessPolicyModule');
  const accessModeElement = html.querySelector('#sm-private-form input[type=radio][checked]');
  const enableApplications = html.getElementById('sm-membership-apply').checked;
  const autoAccept = html.getElementById('sm-membership-automatic').value;
  const enablePassword = html.getElementById('sm-membership-password').checked;
  const passwordValue = html.querySelector('input[name=password]').value;
  const allowHotlinks = html.getElementById('sm-allow-hotlinking-checkbox').checked;
  // NOTE: private site options are not being saved

  const blockClonesElement = html.getElementById('sm-block-clone-checkbox');
  const blockClones = blockClonesElement ? blockClonesElement.checked : false;
  const blockIncludesElement = html.getElementById('sm-block-csi-checkbox');
  const blockIncludes = blockIncludesElement ? blockClonesElement.checked : false;
  // ^ cross-site includes

  let accessMode;
  switch (accessModeElement.id) {
    case 'sm-access-open':
      accessMode = 'open';
      break;
    case 'sm-access-closed':
      accessMode = 'closed';
      break;
    case 'sm-access-private':
      accessMode = 'private';
      break;
    default:
      throw new Error(`Unknown selected access mode ID: ${accessModeElement.id}`);
  }

  return {
    accessMode,
    enableApplications,
    autoAccept,
    membershipPassword: {
      enable: enablePassword,
      value: passwordValue,
    },
    blockClones,
    blockIncludes,
    allowHotlinks,
  };
}

async function fetchHttpsPolicy() {
  console.info('Fetching HTTPS settings');
  const html = await requestModuleHtmlPro('managesite/ManageSiteSecureAccessModule');
  if (!html) {
    // if no paid plan, then HTTP only
    return { http: true, https: false };
  }

  const element = html.getElementById('sm-ssl-mode-select');
  for (const option of element.children) {
    // options are:
    // ''         - disabled
    // 'ssl'      - HTTP & HTTPS
    // 'ssl_only' - HTTPS only
    if (option.selected) {
      switch (option.value) {
        case '':
          return { http: true, https: false };
        case 'ssl':
          return { http: true, https: true };
        case 'ssl_only':
          return { http: false, https: true };
        default:
          throw new Error(`Unknown value in selected option '${option.value}' for secure access mode`);
      }
    }
  }

  throw new Error("Couldn't find selected option for secure access mode");
}

async function fetchApiAccess() {
  console.info('Fetching API access settings');
  const html = await requestModuleHtml('managesite/ManageSiteApiModule');
  const memberReadElement = html.querySelector('input[name=read-1]');
  const adminReadElement = html.querySelector('input[name=read-2]');
  const memberWriteElement = html.querySelector('input[name=write-1]');
  const adminWriteElement = html.querySelector('input[name=write-2]');

  return {
    member: {
      read: memberReadElement.checked,
      write: memberWriteElement.checked,
    },
    admin: {
      read: adminReadElement.checked,
      write: adminWriteElement.checked,
    }
  };
}

async function fetchUserIconPolicy() {
  console.info('Fetching user icon policy');
  const html = await requestModuleHtmlPro('managesite/ManageSiteUserIconsModule');
  if (!html) {
    // default is to show everything
    return {
      avatar: true,
      karma: true,
      pro: true,
    };
  }

  const element = html.querySelector('#sm-usericons-form input[checked]');
  switch (element.value) {
    // "Avatar, Karma, Pro icons"
    case 'aks':
      return {
        avatar: true,
        karma: true,
        pro: true,
      };
    // "avatar, Pro icons (skip karma)"
    case 'as':
      return {
        avatar: true,
        karma: false,
        pro: true,
      };
    // "avatar, karma (skip Pro icons)"
    case 'ak':
      return {
        avatar: true,
        karma: true,
        pro: false,
      };
    // "only avatar"
    case 'a':
      return {
        avatar: true,
        karma: false,
        pro: false,
      };
    // "just names, nothing graphical"
    case '':
      return {
        avatar: false,
        karma: false,
        pro: false,
      };
    // error
    default:
      throw new Error(`Unexpected user icon display value: '${element.value}'`);
  }
}

async function fetchBlockLinkPolicy() {
  console.info('Fetching link block policy');
  const html = await requestModuleHtml('managesite/abuse/ManageSiteOptionAbuseModule');
  const anonymousElement = html.querySelector('input[name=blockLink]');
  const karmaElement = html.querySelector('select[name=karmaLevel] option[selected]');
  const blockKarmaLevel = parseInt(karmaElement.value);
  if (isNaN(blockKarmaLevel)) {
    throw new Error(`Invalid karma level value: ${karmaElement.value}`);
  }

  return {
    blockAnonymous: anonymousElement.checked,
    blockKarmaLevel,
  };
}

async function fetchIcons() {
  console.info('Fetching site icons');
  const filenameRegex = /\/local--\w+\/(\w+\.\w+)\?\d+/;

  async function fetchIcon(module) {
    console.info(`Fetching favicon for module ${module}`);
    const html = await requestModuleHtml(module);
    const alreadyUploadedElement = html.querySelector('h2');
    if (alreadyUploadedElement === null) {
      // There is an <h2> with "You have already uploaded a favicon"
      // or similar if an icon has been uploaded. So if it's absent,
      // then we say no icon has been uploaded and can return null.
      return null;
    }

    const imageElement = html.querySelector('td img');
    const filename = imageElement.src.match(filenameRegex)[1];
    const response = await fetch(imageElement.src);
    if (response.status !== 200) {
      throw new Error(`Unable to fetch image, got HTTP ${response.status}`);
    }

    const blob = await response.blob();
    return { filename, blob };
  }

  return Promise.all([
    fetchIcon('managesite/icons/ManageSiteFaviconModule'),
    fetchIcon('managesite/icons/ManageSiteIosIconModule'),
    fetchIcon('managesite/icons/ManageSiteWindowsIconModule'),
  ]);
}

async function fetchCategorySettings() {
  console.info('Fetching category settings');

  // Fetch category JSON
  const result = await requestModule('managesite/ManageSiteLicenseModule');
  const rawCategories = result['categories'];
  console.debug('categories', rawCategories);

  // License values
  console.info('Fetching license data');
  const html = parseHtml(result['body']);
  const licenseElements = html.querySelectorAll('#sm-license-lic option');
  const licenses = {};
  for (const licenseElement of licenseElements) {
    const licenseId = licenseElement.value;
    const licenseText = licenseElement.innerText;
    licenses[licenseId] = licenseText;
  }

  // Build category data
  const categories = {};
  for (const raw of rawCategories) {
    categories[raw.name] = {
      id: raw.categry_id,
      name: raw.name,
      theme: {
        id: raw.theme_id,
        default: raw.theme_default,
        externalUrl: raw.theme_external_url,
      },
      layout: {
        id: raw.layout_id,
        default: raw.layout_default,
      },
      license: {
        id: raw.license_id,
        default: raw.license_default,
        custom: raw.license_other,
        name: licenses[raw.license_id],
      },
      perPageDiscussion: {
        enable: raw.per_page_discussion,
        default: raw.per_page_discussion_default,
      },
      nav: {
        default: raw.nav_default,
        topBar: raw.top_bar_page_name,
        sideBar: raw.side_bar_page_name,
      },
      template: {
        id: raw.template_id,
        pageTitle: raw.page_title_template,
      },
      autonumerate: raw.autonumerate,
      rating: parseRating(raw.rating),
      permissions: parsePagePermissions(raw.permissions_default, raw.permissions),
    };
  }

  return categories;
}

async function fetchThemesAndLayouts() {
  console.info('Fetching Wikidot theme data');
  const regex = /WIKIDOT\.modules\.ManageSiteCustomThemesModule\.listeners\.edit(Theme|Layout)\(event, (\d+)\)/;
  const html = await requestModuleHtml('managesite/themes/ManageSiteCustomThemesModule');
  const themes = [];
  const layouts = [];

  async function fetchTheme(themeId) {
    const html = await requestModuleHtml('managesite/themes/ManageSiteEditCustomThemeModule', { themeId });
    const nameElement = html.querySelector('form input[name=name]');
    const extendsElement = html.querySelector('form select[name=parentTheme] option[selected]');
    const layoutElement = html.querySelector('form select[name=layoutId] option[selected]');
    const codeElement = html.getElementById('sm-csscode');

    themes.push({
      id: themeId,
      name: nameElement.value,
      code: codeElement.innerText,
      layout: {
        id: parseInt(layoutElement.value),
        name: layoutElement.innerText,
      },
      extendsTheme: {
        id: parseInt(extendsElement.value),
        name: extendsElement.innerText,
      },
    });
  }

  async function fetchLayout(layoutId) {
    const html = await requestModuleHtml('managesite/themes/ManageSiteEditCustomLayoutModule', { layoutId });
    const nameElement = html.querySelector('input[name=layout-name]');
    const codeElement = html.getElementById('sm-layoutcode');
    const usesBootstrap = html.querySelector('input[name=use-bootstrap]').checked;
    const bootstrapVersionElement = html.querySelector('select[name=bootstrap-version] option[selected]');

    layouts.push({
      id: layoutId,
      name: nameElement.value,
      bootstrap: usesBootstrap
        ? bootstrapVersionElement.value
        : null,
      code: codeElement.innerText,
    });
  }

  const editButtons = html.querySelectorAll('table td a.btn-success');
  for (const editButton of editButtons) {
    if (editButton.classList.contains('disabled')) {
      // ignore default layouts
      console.warn('Ignoring default item', editButton);
      continue;
    }

    const callback = editButton.getAttribute('onclick');
    const match = callback.match(regex);
    if (match === null) {
      throw new Error(`No regex match for callback: ${callback}`);
    }

    const id = parseInt(match[2]);
    switch (match[1]) {
      case 'Theme':
        await fetchTheme(id);
        break;
      case 'Layout':
        await fetchLayout(id);
        break;
      default:
        throw new Error(`Somehow got an invalid first group: ${match[1]}`);
    }
  }

  return { themes, layouts };
}

async function fetchUserBans() {
  console.info('Fetching user ban data');
  const html = await requestModuleHtml('managesite/blocks/ManageSiteUserBlocksModule');

  // if this element is present then there are no bans
  // however! it could be present but with 'display: none'
  const noBansElement = html.querySelector('div.alert');
  if (noBansElement !== null && noBansElement.style.display !== 'none') {
    console.warn("Found alert element in user bans, shouldn't be any bans here", noBansElement);
    return [];
  }

  const ubans = html.querySelectorAll('table tr');
  const bans = [];
  // skip the first row, is header
  for (let i = 1; i < ubans.length; i++) {
    const uban = ubans[i];
    const userElement = uban.querySelector('td span.printuser');
    const dateElement = uban.querySelector('td span.odate');
    const reasonElement = uban.querySelector('td[style]');
    bans.push({
      userId: parseUserElement(userElement),
      timestamp: parseDateElement(dateElement),
      reason: reasonElement.innerText.trim(),
    });
  }
  return bans;
}

async function fetchIpBans() {
  console.info('Fetching IP ban data');
  const html = await requestModuleHtml('managesite/blocks/ManageSiteIpBlocksModule');

  // like above, this means no bans
  const noBansElement = html.querySelector('div.alert');
  if (noBansElement !== null && noBansElement.style.display !== 'none') {
    console.warn("Found alert element in user bans, shouldn't be any bans here", noBansElement);
    return [];
  }

  const ibans = html.querySelectorAll('table tr');
  // skip the first row, which is a header
  const bans = [];
  for (let i = 1; i < ibans.length; i++) {
    const iban = ibans[i];
    const ipElement = iban.querySelector('td');
    const dateElement = iban.querySelector('td span.odate');
    const reasonElement = iban.querySelector('td[style]');
    bans.push({
      ip: ipElement.innerText.trim(),
      timestamp: parseDateElement(dateElement),
      reason: reasonElement.innerText.trim(),
    });
  }
  return bans;
}

async function fetchSiteMembers() {
  console.info('Fetching site members');

  async function fetchUsers(module) {
    console.info(`Requesting user data from module ${module}`);

    const users = [];
    let page = 1;
    let maxPages;

    do {
      console.debug(`Retrieving page ${page} of ${maxPages || '<unknown>'}`);
      const html = await requestModuleHtml(module, { page });
      const entries = html.querySelectorAll('table tr');
      // skip the first row, is header
      for (let i = 1; i < entries.length; i++) {
        const entry = entries[i];
        const userElement = entry.querySelector('td span.printuser');
        const userId = parseUserElement(userElement);

        const dateElement = entry.querySelector('td span.odate');
        if (dateElement === null) {
          // this must be the moderators or admins list
          // just emit a list of user IDs
          users.push(userId);
        } else {
          // this must be the regular list of members
          // which includes join dates. we want this
          // information so we add it to the object
          const joined = parseDateElement(dateElement);
          users.push({ userId, joined });
        }
      }

      // If there's a pager, there are multiple pages, iterate through each one.
      // We only try this on the first iteration, obviously.
      if (page === 1) {
        const pagerElement = html.querySelector('.pager');
        if (pagerElement === null) {
          // no more pages
          break;
        }

        // First, get the maximum number of pages.
        // The pager is laid out like this:
        // [previous] [1] [2] ... [398] [399] [400] [401] [402] ... [998] [999] [next]
        //
        // Where the page number buttons (and number of them) differ depending on one's position.
        // However, it always ends with "next", and second-to-last is the final page number.
        // We can use this to get the last page number.
        const buttonChildren = pagerElement.querySelectorAll('.target');
        const lastButton = buttonChildren[buttonChildren.length - 2];
        const lastButtonText = lastButton.innerText
        maxPages = parseInt(lastButtonText);
        if (isNaN(maxPages)) {
          throw new Error(`Invalid value for page index: ${lastButtonText}`);
        }
      }

      page++;
    } while (page <= maxPages); // 1-indexing

    return users;
  }

  const [members, moderators, admins] = await Promise.all([
    fetchUsers('managesite/members/ManageSiteMembersListModule'),
    fetchUsers('managesite/members/ManageSiteModeratorsModule'),
    fetchUsers('managesite/members/ManageSiteAdminsModule'),
  ]);
  return { members, moderators, admins };
}

async function fetchForumSettings() {
  const html = await requestModuleHtml('managesite/ManageSiteForumSettingsModule');

  const noForumElement = html.querySelector('div.lead');
  if (noForumElement !== null) {
    return null;
  }

  const nestingLevelSelectElemment = html.getElementById('max-nest-level');
  const nestingLevelElement = nestingLevelSelectElemment.querySelector('option[selected]');
  const nestingLevel = parseInt(nestingLevelElement.value);

  const result = await requestModule('managesite/ManageSiteGetForumLayoutModule');

  if (result.groups.length !== result.categories.length) {
    throw new Error(`Forum structure mismatch: group count ${result.groups.length} != category[] count ${result.categories.lengths}`);
  }

  const forum = { nestingLevel, groups: [], categories: [] };
  for (let i = 0; i < result.groups.length; i++) {
    const { name, description, group_id, visible } = result.groups[i];
    const categoryGroup = result.categories[i];

    // Add forum group
    forum.groups.push({
      groupId: group_id,
      name,
      description,
      visible,
    });

    // Add individual forum categories within that group
    for (const category of categoryGroup) {
      const {
        name,
        description,
        category_id,
        posts,
        number_threads,
        permissions,
        max_nest_level,
      } = category;

      forum.categories.push({
        categoryId: category_id,
        groupId: group_id,
        name,
        description,
        maxNestLevel: max_nest_level,
        stats: {
          posts,
          threads: number_threads,
        },
        permissions: parseForumPermissions(permissions),
      });
    }
  }
  return forum;
}

// Main

async function runBackupInner(withSiteMembers) {
  // Fetch data
  const siteInfo = await fetchBasicInfo();
  siteInfo.domains = await fetchDomainSettings();
  siteInfo.toolbar = await fetchToolbarSettings();
  siteInfo.userProfile = await fetchUserProfileSettings();
  siteInfo.customFooter = await fetchCustomFooter();
  siteInfo.access = await fetchAccessPolicy();
  siteInfo.tls = await fetchHttpsPolicy();
  siteInfo.api = await fetchApiAccess();
  siteInfo.userIcons = await fetchUserIconPolicy();
  siteInfo.blockLinks = await fetchBlockLinkPolicy();
  const icons = await fetchIcons();
  const categories = await fetchCategorySettings();
  const { themes, layouts } = await fetchThemesAndLayouts();
  const [userBans, ipBans] = await Promise.all([fetchUserBans(), fetchIpBans()]);
  const forum = await fetchForumSettings();

  // Build and download ZIP
  const zipFiles = [
    ['site.json', siteInfo],
    ['categories.json', categories],
    ['themes.json', themes],
    ['layouts.json', layouts],
    ['bans.json', { user: userBans, ip: ipBans }],
  ];

  // If site members are enabled
  //
  // In full backups this is always collected, but we give an option
  // of excluding it in the UI since for large sites it's quite slow.
  if (withSiteMembers) {
    const members = await fetchSiteMembers();
    zipFiles.push(['members.json', members]);
  }

  // Add forum is enabled
  if (forum !== null) {
    zipFiles.push(['forum.json', forum]);
  }

  // Add favicons
  for (const icon of icons) {
    if (icon !== null) {
      zipFiles.push([icon.filename, icon.blob]);
    }
  }

  const zipBlob = await createZip(zipFiles);
  promptFileDownload(`${siteInfo.slug}.zip`, zipBlob);

  /*
  URL objects don't need to be revoked anymore since the browser will close immediately after finishing

  URL.revokeObjectURL(zipBlob);

  for (const icon of icons) {
    if (icon !== null) {
      URL.revokeObjectURL(icon.blob);
    }
  }
    */
}

// Add the function to the global context
// Selenium's driver.execute_script executes scripts as an anonymous function which is immediately called
// The defined functions wouldn't otherwise persist until the backup is started
window.runBackupInner = runBackupInner