export namespace config {
	
	export class Session {
	    tabs: string[];
	    active: string;
	    folder: string;
	    showSidebar: boolean;
	    showToc: boolean;
	    zoom: number;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabs = source["tabs"];
	        this.active = source["active"];
	        this.folder = source["folder"];
	        this.showSidebar = source["showSidebar"];
	        this.showToc = source["showToc"];
	        this.zoom = source["zoom"];
	    }
	}

}

export namespace fstree {
	
	export class Entry {
	    name: string;
	    path: string;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	    }
	}

}

export namespace links {
	
	export class Target {
	    kind: string;
	    path?: string;
	    fragment?: string;
	    url?: string;
	
	    static createFrom(source: any = {}) {
	        return new Target(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.fragment = source["fragment"];
	        this.url = source["url"];
	    }
	}

}

export namespace main {
	
	export class Document {
	    path: string;
	    name: string;
	    html: string;
	    headings: markdown.Heading[];
	
	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.html = source["html"];
	        this.headings = this.convertValues(source["headings"], markdown.Heading);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Source {
	    path: string;
	    name: string;
	    text: string;
	    format: textfile.Format;
	
	    static createFrom(source: any = {}) {
	        return new Source(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.text = source["text"];
	        this.format = this.convertValues(source["format"], textfile.Format);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StartupArgs {
	    files: string[];
	    folder: string;
	
	    static createFrom(source: any = {}) {
	        return new StartupArgs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = source["files"];
	        this.folder = source["folder"];
	    }
	}

}

export namespace markdown {
	
	export class Heading {
	    level: number;
	    id: string;
	    text: string;
	    line: number;
	
	    static createFrom(source: any = {}) {
	        return new Heading(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.id = source["id"];
	        this.text = source["text"];
	        this.line = source["line"];
	    }
	}
	export class Result {
	    html: string;
	    headings: Heading[];
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.html = source["html"];
	        this.headings = this.convertValues(source["headings"], Heading);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ThemeCSS {
	    light: string;
	    dark: string;
	
	    static createFrom(source: any = {}) {
	        return new ThemeCSS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.light = source["light"];
	        this.dark = source["dark"];
	    }
	}

}

export namespace textfile {
	
	export class Format {
	    encoding: string;
	    lineEnding: string;
	
	    static createFrom(source: any = {}) {
	        return new Format(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.encoding = source["encoding"];
	        this.lineEnding = source["lineEnding"];
	    }
	}

}

