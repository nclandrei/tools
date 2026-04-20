// kubectl builder engine — pure command-shape helpers
// Works in both Node (require) and browser (script tag -> window.KubectlBuilder)
(function(exports) {
  'use strict';

  // POSIX shell metacharacters that force single-quoting.
  const SHELL_META = /[\s"'$`\\()|&;<>*?{}[\]]/;

  function shellQuote(s) {
    if (s == null || s === '') return s;
    if (!SHELL_META.test(s)) return s;
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function target(state) {
    if (!state.resource) return '';
    return state.name ? state.resource + '/' + state.name : state.resource;
  }

  function pushNamespace(parts, state) {
    if (state.allNamespaces) parts.push('-A');
    else if (state.namespace) parts.push('-n', state.namespace);
  }

  function pushOutput(parts, state) {
    if (!state.output) return;
    if (state.output === 'jsonpath') {
      parts.push('-o', shellQuote('jsonpath=' + (state.jsonpath || '')));
    } else if (state.output === 'custom-columns') {
      parts.push('-o', shellQuote('custom-columns=' + (state.customColumns || '')));
    } else {
      parts.push('-o', state.output);
    }
  }

  function pushFileOrTarget(parts, state) {
    if (state.filename) {
      parts.push('-f', shellQuote(state.filename));
      if (state.recursive) parts.push('-R');
    } else {
      const t = target(state);
      if (t) parts.push(t);
    }
  }

  function pushSelectors(parts, state) {
    if (state.selector) parts.push('-l', shellQuote(state.selector));
    if (state.fieldSelector) {
      parts.push('--field-selector=' + shellQuote(state.fieldSelector));
    }
  }

  function buildCommand(state) {
    const s = state || {};
    const verb = s.verb || 'get';
    const parts = ['kubectl'];

    if (s.context) parts.push('--context=' + shellQuote(s.context));
    if (s.kubeconfig) parts.push('--kubeconfig=' + shellQuote(s.kubeconfig));

    switch (verb) {
      case 'logs': {
        parts.push('logs');
        if (s.follow) parts.push('-f');
        if (s.previous) parts.push('-p');
        if (s.tail !== '' && s.tail != null) parts.push('--tail=' + s.tail);
        if (s.since) parts.push('--since=' + s.since);
        if (s.container) parts.push('-c', s.container);
        pushNamespace(parts, s);
        if (s.name) parts.push(s.name);
        break;
      }

      case 'exec': {
        parts.push('exec');
        const flags = (s.stdin ? 'i' : '') + (s.tty ? 't' : '');
        if (flags) parts.push('-' + flags);
        const t = s.name || target(s);
        if (t) parts.push(t);
        if (s.container) parts.push('-c', s.container);
        pushNamespace(parts, s);
        if (s.execCommand) {
          parts.push('--');
          const cmd = String(s.execCommand).split(/\s+/).filter(Boolean);
          parts.push(...cmd);
        }
        break;
      }

      case 'apply':
      case 'create': {
        parts.push(verb);
        pushFileOrTarget(parts, s);
        if (verb === 'apply' && s.serverSide) parts.push('--server-side');
        if (s.dryRun) parts.push('--dry-run=' + s.dryRun);
        pushNamespace(parts, s);
        break;
      }

      case 'delete': {
        parts.push('delete');
        pushFileOrTarget(parts, s);
        if (s.force) parts.push('--force');
        if (s.gracePeriod !== '' && s.gracePeriod != null) {
          parts.push('--grace-period=' + s.gracePeriod);
        }
        if (s.cascade) parts.push('--cascade=' + s.cascade);
        pushNamespace(parts, s);
        pushSelectors(parts, s);
        break;
      }

      case 'scale': {
        parts.push('scale');
        const t = target(s);
        if (t) parts.push(t);
        if (s.replicas !== '' && s.replicas != null) {
          parts.push('--replicas=' + s.replicas);
        }
        pushNamespace(parts, s);
        break;
      }

      case 'rollout': {
        parts.push('rollout', s.rolloutAction || 'status');
        const t = target(s);
        if (t) parts.push(t);
        pushNamespace(parts, s);
        break;
      }

      case 'port-forward': {
        parts.push('port-forward');
        const t = target(s);
        if (t) parts.push(t);
        const lp = s.localPort || '';
        const rp = s.remotePort || '';
        if (lp && rp) parts.push(lp + ':' + rp);
        else if (lp) parts.push(lp);
        else if (rp) parts.push(':' + rp);
        pushNamespace(parts, s);
        break;
      }

      case 'run': {
        parts.push('run');
        if (s.name) parts.push(s.name);
        if (s.image) parts.push('--image=' + s.image);
        pushNamespace(parts, s);
        break;
      }

      default: {
        // get, describe, edit, top, explain, etc.
        parts.push(verb);
        const t = target(s);
        if (t) parts.push(t);
        pushNamespace(parts, s);
        pushSelectors(parts, s);
        pushOutput(parts, s);
        if (verb === 'get' && s.watch) parts.push('-w');
      }
    }

    return parts.join(' ');
  }

  exports.buildCommand = buildCommand;
  exports.shellQuote = shellQuote;
})(typeof module !== 'undefined' ? module.exports : (window.KubectlBuilder = window.KubectlBuilder || {}));
