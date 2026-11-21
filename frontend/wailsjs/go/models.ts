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

}

export namespace markdown {
	
	export class Heading {
	    level: number;
	    id: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Heading(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.id = source["id"];
	        this.text = source["text"];
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

