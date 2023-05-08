type AnyUpdater = (...args: any[]) => any;

type Listener<TState> = (next: TState, prev: TState) => void;

interface StoreOptions<
  TState,
  TUpdater extends AnyUpdater = (cb: TState) => TState
> {
  updateFn?: (previous: TState) => (updater: TUpdater) => TState;
  onSubscribe?: (
    listener: Listener<TState>,
    store: Store<TState, TUpdater>
  ) => () => void;
  onUpdate?: (next: TState, prev: TState) => void;
}

class Store<
  TState,
  TUpdater extends AnyUpdater = (cb: TState) => TState
> {
  listeners = new Set<Listener<TState>>();
  state: TState;
  options?: StoreOptions<TState, TUpdater>;
  batching = false;
  queue: ((...args: any[]) => void)[] = [];

  constructor(initialState: TState, options?: StoreOptions<TState, TUpdater>) {
    this.state = initialState;
    this.options = options;
  }

  setState = (updater: TUpdater) => {
    const previous = this.state;
    this.state = this.options?.updateFn
      ? this.options.updateFn(previous)(updater)
      : (updater as any)(previous);

    if (this.state === previous) return;

    this.options?.onUpdate?.(this.state, previous);

    this.queue.push(() => {
      this.listeners.forEach((listener) => listener(this.state, previous));
    });
    this.#flush();
  };

  #flush = () => {
    if (this.batching) return;
    this.queue.forEach((cb) => cb());
    this.queue = [];
  };

  batch = (cb: () => void) => {
    this.batching = true;
    cb();
    this.batching = false;
    this.#flush();
  };
}

interface RouterHistory {
  location: RouterLocation;
  listen: (cb: () => void) => () => void;
  push: (path: string, state: any) => void;
  replace: (path: string, state: any) => void;
  go: (index: number) => void;
  back: () => void;
  forward: () => void;
  createHref: (href: string) => string;
}

interface ParsedPath {
  href: string;
  pathname: string;
  search: string;
}

interface RouterLocation extends ParsedPath {
  state: any;
}

const popStateEvent = "popstate";

function createHistory(opts: {
  getLocation: () => RouterLocation;
  listener: (onUpdate: () => void) => () => void;
  pushState: (path: string, state: any) => void;
  replaceState: (path: string, state: any) => void;
  go: (n: number) => void;
  back: () => void;
  forward: () => void;
  createHref: (path: string) => string;
}): RouterHistory {
  let currentLocation = opts.getLocation();
  let unsub = () => {};
  let listeners = new Set<() => void>();
  let queue: (() => void)[] = [];

  const tryFlush = () => {
    while (queue.length) {
      queue.shift()?.();
    }

    onUpdate();
  };

  const queueTask = (task: () => void) => {
    queue.push(task);
    tryFlush();
  };

  const onUpdate = () => {
    currentLocation = opts.getLocation();
    listeners.forEach((listener) => listener());
  };

  return {
    get location() {
      return currentLocation;
    },
    listen: (cb: () => void) => {
      if (listeners.size === 0) {
        unsub = opts.listener(onUpdate);
      }
      listeners.add(cb);

      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          unsub();
        }
      };
    },
    push: (path: string, state: any) => {
      queueTask(() => {
        opts.pushState(path, state);
      });
    },
    replace: (path: string, state: any) => {
      queueTask(() => {
        opts.replaceState(path, state);
      });
    },
    go: (index) => {
      queueTask(() => {
        opts.go(index);
      });
    },
    back: () => {
      queueTask(() => {
        opts.back();
      });
    },
    forward: () => {
      queueTask(() => {
        opts.forward();
      });
    },
    createHref: (str) => opts.createHref(str),
  };
}

function createBrowserHistory(): RouterHistory {
  const getHref = () => `${window.location.pathname}${window.location.search}`;
  const createHref = (path: string) => path;
  const getLocation = () => parseLocation(getHref(), history.state);

  return createHistory({
    getLocation,
    listener: (onUpdate) => {
      window.addEventListener(popStateEvent, onUpdate);
      return () => {
        window.removeEventListener(popStateEvent, onUpdate);
      };
    },
    pushState: (path, state) => {
      window.history.pushState(
        { ...state, key: createRandomKey() },
        "",
        createHref(path)
      );
    },
    replaceState: (path, state) => {
      window.history.replaceState(
        { ...state, key: createRandomKey() },
        "",
        createHref(path)
      );
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    go: (n) => window.history.go(n),
    createHref: (path) => createHref(path),
  });
}

function parseLocation(href: string, state: History["state"]): RouterLocation {
  let searchIndex = href.indexOf("?");

  return {
    href,
    pathname: href.substring(0, searchIndex),
    search: searchIndex > -1 ? href.substring(searchIndex) : "",
    state,
  };
}

// Thanks co-pilot!
function createRandomKey() {
  return (Math.random() + 1).toString(36).substring(7);
}

function encode(obj: any, pfx?: string) {
  var k,
    i,
    tmp,
    str = "";

  for (k in obj) {
    if ((tmp = obj[k]) !== void 0) {
      if (Array.isArray(tmp)) {
        for (i = 0; i < tmp.length; i++) {
          str && (str += "&");
          str += encodeURIComponent(k) + "=" + encodeURIComponent(tmp[i]);
        }
      } else {
        str && (str += "&");
        str += encodeURIComponent(k) + "=" + encodeURIComponent(tmp);
      }
    }
  }

  return (pfx || "") + str;
}

function toValue(mix: any) {
  if (!mix) return "";
  var str = decodeURIComponent(mix);
  if (str === "false") return false;
  if (str === "true") return true;
  if (str.charAt(0) === "0") return str;
  return +str * 0 === 0 ? +str : str;
}

function decode(str: string) {
  let tmp: any;
  let k: any;
  let out: Record<string, ConcatArray<never> | string | number | boolean> = {};
  let arr: string[] = str.split("&");

  while ((tmp = arr.shift())) {
    tmp = tmp.split("=");
    k = tmp.shift();
    if (out[k] !== void 0) {
      // @ts-ignore
      out[k] = [].concat(out[k], toValue(tmp.shift()));
    } else {
      out[k] = toValue(tmp.shift());
    }
  }

  return out;
}

function parseSearchWith(parser: (str: string) => any) {
  return (searchStr: string) => {
    if (searchStr.substring(0, 1) === "?") {
      searchStr = searchStr.substring(1);
    }

    let query: Record<string, unknown> = decode(searchStr);

    // Try to parse any query params that might be json
    for (let key in query) {
      const value = query[key];
      if (typeof value === "string") {
        try {
          query[key] = parser(value);
        } catch (err) {
          //
        }
      }
    }

    return query;
  };
}

function stringifySearchWith(stringify: (search: any) => string) {
  return (search: Record<string, any>) => {
    search = { ...search };

    if (search) {
      Object.keys(search).forEach((key) => {
        const val = search[key];
        if (typeof val === "undefined" || val === undefined) {
          delete search[key];
        } else if (val && typeof val === "object" && val !== null) {
          try {
            search[key] = stringify(val);
          } catch (err) {
            // silent
          }
        }
      });
    }

    const searchStr = encode(search as Record<string, string>).toString();

    return searchStr ? `?${searchStr}` : "";
  };
}

interface RouterStore<T> {
  latestLocation: ParsedLocation<T>;
  currentLocation: ParsedLocation<T>;
}

interface BuildNextOptions<T> {
  search: Updater<T>;
  state?: LocationState;
}

export interface LocationState {}

interface ParsedLocation<TSearchObj = {}> {
  href: string;
  pathname: string;
  search: TSearchObj;
  searchStr: string;
  state: TSearchObj;
  key?: string;
}

type Updater<TPrevious, TResult = TPrevious> =
  | TResult
  | ((prev: TPrevious) => TResult);

function S(e: any, t: any) {
  return typeof e == "function" ? e(t) : e;
}
function d(e: any, t: any) {
  if (e === t) return e;
  let r = t,
    n = Array.isArray(e) && Array.isArray(r);
  if (n || (R(e) && R(r))) {
    let o = n ? e.length : Object.keys(e).length,
      a = n ? r : Object.keys(r),
      s = a.length,
      c: any = n ? [] : {},
      h = 0;
    for (let i = 0; i < s; i++) {
      let u = n ? i : a[i];
      (c[u] = d(e[u], r[u])), c[u] === e[u] && h++;
    }
    return o === s && h === o ? e : c;
  }
  return r;
}
function R(e: any) {
  if (!T(e)) return !1;
  let t = e.constructor;
  if (typeof t > "u") return !0;
  let r = t.prototype;
  return !(!T(r) || !r.hasOwnProperty("isPrototypeOf"));
}
function T(e: any) {
  return Object.prototype.toString.call(e) === "[object Object]";
}
function N(e: any) {
  return e === "/" ? e : e.replace(/^\/{1,}/, "");
}
function B(e: any) {
  return e === "/" ? e : e.replace(/\/{1,}$/, "");
}
function w(e: any) {
  return B(N(e));
}

class Router<T> {
  options;
  history!: RouterHistory
  #t: any;
  basepath;
  __store;
  state;
  constructor(t: any) {
    (this.options = {
      ...t,
      stringifySearch: stringifySearchWith(JSON.stringify),
      parseSearch: parseSearchWith(JSON.parse),
      validateSearch: t.validateFunc,
      preSearchFilters: [(sf: any) => ({ ...t.defaultValues, ...sf })],
    }),
      (this.__store = new Store<RouterStore<T>>(getInitialRouterState(), {
        onUpdate: (n) => {
          this.state = n;
        },
      })),
      (this.state = this.__store.state),
      (this.basepath = window.location.pathname),
      this.update(t);
    let r = this.#buildLocation({ search: !0, state: !0 });
    this.state.latestLocation.href !== r.href && this.navigate({ ...r });
  }
  update = (t: any) => {
    if (
      (Object.assign(this.options, t),
      !this.history ||
        (this.options.history && this.options.history !== this.history))
    ) {
      this.#t && this.#t(), (this.history = createBrowserHistory());
      let n = this.#e();
      this.__store.setState((o) => ({
        ...o,
        latestLocation: n,
        currentLocation: n,
      })),
        (this.#t = this.history.listen(() => {
          this.load({ next: this.#e(this.state.latestLocation) });
        }));
    }
    let { basepath: r } = this.options;
    return (this.basepath = `/${w(r ?? "") ?? ""}`), this;
  };
  load = (t: any) => {
    this.__store.batch(() => {
      t?.next &&
        this.__store.setState((n) => ({ ...n, latestLocation: t.next }));
    }),
      this.__store.setState((n) => ({
        ...n,
        currentLocation: this.state.latestLocation,
      }));
  };
  #e = (t?: any) => {
    let { pathname: r, search: n, state: o } = this.history.location,
      a = this.options.parseSearch(n);
    return {
      pathname: r,
      searchStr: n,
      search: d(t?.search, a),
      href: `${r}${n}`,
      state: o,
    };
  };
  #buildLocation = (t = {} as any): ParsedLocation => {
    let o = this.options.preSearchFilters,
      s = o?.reduce((l: any, g: any) => g(l), this.state.latestLocation.search);
    let c =
      t.search === !0
        ? s
        : t.search
        ? S(t.search, s) ?? {}
        : o?.length
        ? s
        : {};
    let i = d(this.state.latestLocation.search, c),
      u = this.options.stringifySearch(i);
    let C =
      t.state === !0
        ? this.state.latestLocation.state
        : S(t.state, this.state.latestLocation.state);
    return {
      pathname: window.location.pathname,
      search: i,
      searchStr: u,
      state: C,
      href: this.history.createHref(`${window.location.pathname}/${u}`),
    };
  };
  navigate = (t: any): void => {
    let r = this.#buildLocation(t),
      n = "" + Date.now() + Math.random();
    let o = `${r.pathname}${r.searchStr}`;
    return this.history.replace(o, { id: n, ...r.state });
  };
}

function getInitialRouterState(): RouterStore<any> {
  return {
    latestLocation: null!,
    currentLocation: null!,
  };
}
function useSearch<T>(defaultValues: T,validateFunc: any ) {
  const router = new Router<T>({
    validateSearch: validateFunc,
    preSearchFilters: [(t: T) => ({ ...defaultValues, ...t })],
    basepath: window.location.pathname
  });
  return {
    search: router.__store.state.currentLocation?.search,
    navigate: function (r: BuildNextOptions<T>) {
      return router.navigate(r);
    },
    history: router.history
  };
}

export { useSearch };
