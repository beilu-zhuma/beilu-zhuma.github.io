type ZhumaTrack = {
    name: string;
    artist?: string;
    url: string;
    cover?: string;
    lrc?: string;
}

type APlayerInstance = {
    audio: HTMLAudioElement;
    list: {
        index: number;
        switch: (index: number) => void;
    };
    on: (event: string, callback: () => void) => void;
    pause: () => void;
    play: () => void;
    volume: (value?: number, nostorage?: boolean) => number;
}

type PjaxInstance = {
    refresh: (element?: Document | Element) => void;
}

declare global {
    interface Window {
        APlayer?: new (options: Record<string, unknown>) => APlayerInstance;
        Pjax?: new (options: Record<string, unknown>) => PjaxInstance;
        Stack?: {
            init: () => void;
        };
        StackSearch?: {
            init: () => void;
        };
        umami?: {
            track: () => void;
        };
        zhumaGiscusThemes?: {
            light: string;
            dark: string;
        };
        zhumaMusicList?: ZhumaTrack[];
        zhumaPlayer?: APlayerInstance;
        zhumaPjax?: PjaxInstance;
    }
}

const playerStateKey = 'ZhumaAPlayerState';

const normalizePath = (url: string) => {
    try {
        return new URL(url, window.location.href).pathname;
    }
    catch {
        return url;
    }
};

const isPjaxableLink = (link: HTMLAnchorElement) => {
    const url = new URL(link.href, window.location.href);

    if (url.origin !== window.location.origin) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;
    if (link.closest('.aplayer, .pswp, [data-no-pjax]')) return false;

    const fileLike = /\.[a-z0-9]{2,8}$/i.test(url.pathname);
    return !fileLike || /\.(html?)$/i.test(url.pathname);
};

const markNoPjaxLinks = (root: Document | Element = document) => {
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
        if (!isPjaxableLink(link)) {
            link.setAttribute('data-no-pjax', '');
        }
    });
};

const readPlayerState = () => {
    try {
        return JSON.parse(localStorage.getItem(playerStateKey) || '{}');
    }
    catch {
        return {};
    }
};

const savePlayerState = () => {
    const player = window.zhumaPlayer;
    if (!player) return;

    localStorage.setItem(playerStateKey, JSON.stringify({
        index: player.list.index,
        currentTime: player.audio.currentTime || 0,
        paused: player.audio.paused,
        volume: player.volume()
    }));
};

const restorePlayerState = (player: APlayerInstance) => {
    const state = readPlayerState();

    if (Number.isInteger(state.index) && state.index >= 0) {
        player.list.switch(state.index);
    }

    if (typeof state.volume === 'number') {
        player.volume(state.volume);
    }

    const restoreTime = () => {
        if (typeof state.currentTime === 'number' && state.currentTime > 0) {
            player.audio.currentTime = state.currentTime;
        }
    };

    if (player.audio.readyState >= 1) {
        restoreTime();
    }
    else {
        player.audio.addEventListener('loadedmetadata', restoreTime, { once: true });
    }
};

const initPlayer = () => {
    if (window.zhumaPlayer || !window.APlayer) return;

    const container = document.getElementById('aplayer');
    const audio = window.zhumaMusicList || [];

    if (!container || audio.length === 0) return;

    const hasLyrics = audio.some((track) => Boolean(track.lrc));

    const player = new window.APlayer({
        container,
        fixed: true,
        autoplay: false,
        listFolded: true,
        listMaxHeight: 180,
        lrcType: hasLyrics ? 3 : 0,
        mutex: true,
        preload: 'metadata',
        theme: '#3f7b70',
        audio
    });

    window.zhumaPlayer = player;
    restorePlayerState(player);

    ['pause', 'play', 'timeupdate', 'volumechange'].forEach((eventName) => {
        player.audio.addEventListener(eventName, savePlayerState);
    });
    player.on('listswitch', savePlayerState);
    window.addEventListener('beforeunload', savePlayerState);
};

const removeDuplicateScripts = () => {
    const seen = new Set<string>();

    document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((script) => {
        const src = normalizePath(script.src);
        if (!src.includes('/ts/') && !src.includes('/js/')) return;

        if (seen.has(src)) {
            script.remove();
            return;
        }

        seen.add(src);
    });
};

let lastPjaxDocument: Document | null = null;

const currentGiscusTheme = () => {
    const themes = window.zhumaGiscusThemes;
    if (!themes) return undefined;

    return document.documentElement.dataset.scheme === 'dark' ? themes.dark : themes.light;
};

const syncGiscusTheme = () => {
    const theme = currentGiscusTheme();
    const iframe = document.querySelector<HTMLIFrameElement>('iframe.giscus-frame');
    if (!theme || !iframe?.contentWindow) return;

    iframe.contentWindow.postMessage({
        giscus: {
            setConfig: {
                theme
            }
        }
    }, 'https://giscus.app');
};

const reloadGiscus = () => {
    const main = document.querySelector('main.main');
    if (!main) return;
    if (main.querySelector('iframe.giscus-frame')) {
        syncGiscusTheme();
        return;
    }

    const liveScript = main.querySelector<HTMLScriptElement>('script[src="https://giscus.app/client.js"]');
    const sourceScript = liveScript
        || lastPjaxDocument?.querySelector<HTMLScriptElement>('main.main script[src="https://giscus.app/client.js"]');

    if (!sourceScript) return;

    const script = document.createElement('script');
    Array.from(sourceScript.attributes).forEach((attribute) => {
        script.setAttribute(attribute.name, attribute.value);
    });

    const theme = currentGiscusTheme();
    if (theme) {
        script.setAttribute('data-theme', theme);
    }

    script.async = true;

    if (liveScript?.parentNode) {
        liveScript.replaceWith(script);
        return;
    }

    const commentsContainer = main.querySelector<HTMLElement>('#comments .memo-comments__body')
        || main.querySelector<HTMLElement>('#comments');
    if (commentsContainer) {
        commentsContainer.appendChild(script);
        return;
    }

    const footer = main.querySelector<HTMLElement>('footer.site-footer');
    main.insertBefore(script, footer);
};

const syncPageShell = (event: Event) => {
    const pjaxEvent = event as unknown as {
        detail?: { request?: XMLHttpRequest };
        options?: { request?: XMLHttpRequest };
        request?: XMLHttpRequest;
    };
    const response = pjaxEvent.detail?.request?.responseText
        || pjaxEvent.options?.request?.responseText
        || pjaxEvent.request?.responseText;

    if (!response) return;

    const nextDocument = new DOMParser().parseFromString(response, 'text/html');
    lastPjaxDocument = nextDocument;
    document.body.className = nextDocument.body.className;

    const container = document.querySelector('.main-container');
    const main = document.querySelector('main.main');
    const currentRightSidebar = document.querySelector('.right-sidebar');
    const nextRightSidebar = nextDocument.querySelector('.right-sidebar');

    if (!container || !main) return;

    if (currentRightSidebar && nextRightSidebar) {
        currentRightSidebar.outerHTML = nextRightSidebar.outerHTML;
    }
    else if (currentRightSidebar && !nextRightSidebar) {
        currentRightSidebar.remove();
    }
    else if (!currentRightSidebar && nextRightSidebar) {
        container.insertBefore(nextRightSidebar, main);
    }
};

const afterPjax = (event?: Event) => {
    if (event) syncPageShell(event);

    removeDuplicateScripts();
    markNoPjaxLinks();
    window.Stack?.init();
    window.StackSearch?.init();
    window.zhumaPjax?.refresh(document);
    window.setTimeout(reloadGiscus, 100);

    if (typeof window.umami?.track === 'function') {
        window.umami.track();
    }
};

const initPjax = () => {
    if (window.zhumaPjax || !window.Pjax) return;

    markNoPjaxLinks();

    window.zhumaPjax = new window.Pjax({
        selectors: [
            'title',
            '.left-sidebar',
            'main.main'
        ],
        elements: 'a[href]:not([target]):not([download]):not([data-no-pjax])',
        cacheBust: false,
        currentUrlFullReload: false,
        scrollRestoration: true
    });

    document.addEventListener('pjax:send', () => savePlayerState());
    document.addEventListener('pjax:complete', afterPjax);

    document.addEventListener('click', (event) => {
        const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
        if (!link || isPjaxableLink(link)) return;
        link.setAttribute('data-no-pjax', '');
    }, true);
};

window.addEventListener('load', () => {
    initPlayer();
    initPjax();
});

window.addEventListener('onColorSchemeChange', syncGiscusTheme);

export {};
