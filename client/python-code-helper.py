"""Local numeric analysis only. No selected path, import, eval, or exec is used."""
import ast
import json
import pathlib
import sys

MAX_INPUT = 16 * 1024 * 1024
MAX_NODES = 100000
MAX_DEPTH = 256
MAX_FUNCTIONS = 10000
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'third_party' / 'radon-6.0.1'))
from radon.visitors import ComplexityVisitor
from radon.raw import analyze
import radon


def distribution(values):
    values = sorted(values)
    n = len(values)
    def quantile(p):
        if not n:
            return None
        at = (n - 1) * p
        lo = int(at)
        hi = min(n - 1, lo + 1)
        return values[lo] + (values[hi] - values[lo]) * (at - lo)
    return {'count': n, 'sum': sum(values), 'min': values[0] if n else None,
            'median': quantile(.5), 'p90': quantile(.9), 'max': values[-1] if n else None,
            'mean': sum(values) / n if n else None}


CONTROLS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With,
            ast.AsyncWith, ast.Match, ast.IfExp, ast.comprehension)
DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
RAW_FIELDS = ('loc', 'lloc', 'sloc', 'comments', 'multi', 'blank', 'single_comments')


def nesting(function):
    stack = [(node, 0) for node in function.body]
    maximum = 0
    while stack:
        node, depth = stack.pop()
        if isinstance(node, DEFINITIONS):
            continue
        if isinstance(node, CONTROLS):
            depth += 1
        maximum = max(maximum, depth)
        stack.extend((child, depth) for child in ast.iter_child_nodes(node))
    return maximum


def measure(sources):
    raw = dict.fromkeys(RAW_FIELDS, 0)
    syntax = dict.fromkeys(('functions', 'asyncFunctions', 'classes', 'lambdas',
        'callExpressions', 'comprehensions', 'withStatements', 'matchStatements', 'exceptionHandlers'), 0)
    cc, parameters, nested, results = [], [], [], []
    nodes_used = functions_used = measured = 0
    for index, source in enumerate(sources):
        reason = None
        file_syntax = dict.fromkeys(syntax, 0)
        try:
            tree = ast.parse(source, filename='<opencost-selected>', mode='exec')
            stack = [(tree, 0)]
            functions, node_count, unsupported = [], 0, False
            while stack:
                node, depth = stack.pop()
                node_count += 1
                if depth > MAX_DEPTH or nodes_used + node_count > MAX_NODES:
                    raise OverflowError()
                name = type(node).__name__
                if name in ('TryStar', 'TemplateStr', 'Interpolation') or (
                    isinstance(node, ast.match_case) and node.guard is not None
                ):
                    unsupported = True
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions.append(node)
                    if functions_used + len(functions) > MAX_FUNCTIONS:
                        raise OverflowError()
                    file_syntax['asyncFunctions' if isinstance(node, ast.AsyncFunctionDef) else 'functions'] += 1
                for cls, key in ((ast.ClassDef, 'classes'), (ast.Lambda, 'lambdas'),
                    (ast.Call, 'callExpressions'), (ast.comprehension, 'comprehensions'),
                    ((ast.With, ast.AsyncWith), 'withStatements'), (ast.Match, 'matchStatements'),
                    (ast.ExceptHandler, 'exceptionHandlers')):
                    if isinstance(node, cls):
                        file_syntax[key] += 1
                stack.extend((child, depth + 1) for child in ast.iter_child_nodes(node))
            nodes_used += node_count
            functions_used += len(functions)
            if unsupported:
                reason = 'unsupported_syntax'
            else:
                # Compile for scope checks (e.g. return outside a function); never execute.
                compile(tree, '<opencost-selected>', 'exec', dont_inherit=True, optimize=0)
                file_raw = analyze(source)
                if file_raw.sloc + file_raw.multi + file_raw.blank + file_raw.single_comments != file_raw.loc:
                    raise ValueError()
                file_cc, file_parameters, file_nested = [], [], []
                for function in functions:
                    visitor = ComplexityVisitor.from_ast(function, no_assert=False)
                    if len(visitor.functions) != 1:
                        raise ValueError()
                    file_cc.append(visitor.functions[0].complexity)
                    args = function.args
                    file_parameters.append(len(args.posonlyargs) + len(args.args) + len(args.kwonlyargs)
                        + int(args.vararg is not None) + int(args.kwarg is not None))
                    file_nested.append(nesting(function))
                for field in RAW_FIELDS:
                    raw[field] += getattr(file_raw, field)
                for key in syntax:
                    syntax[key] += file_syntax[key]
                cc.extend(file_cc)
                parameters.extend(file_parameters)
                nested.extend(file_nested)
                measured += 1
        except (SyntaxError, IndentationError, TabError):
            reason = 'parse_error'
        except (OverflowError, RecursionError, MemoryError):
            reason = 'ast_limit'
            # Reserve the remaining budget; later files cannot escape this batch limit.
            nodes_used = MAX_NODES
        except Exception:
            reason = 'parser_error'
        results.append({'index': index, 'status': 'unavailable' if reason else 'measured', 'reason': reason or 'none'})
    return {'format': 'opencost-python-helper-1', 'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
            'radonVersion': radon.__version__, 'results': results, 'measuredFiles': measured,
            'metrics': {'raw': raw, 'syntax': syntax, 'functionCount': len(cc),
                'cyclomatic': distribution(cc), 'parameters': distribution(parameters), 'controlNesting': distribution(nested)} if measured else None}


def main():
    if not (3, 10) <= sys.version_info[:2] <= (3, 15):
        raise ValueError()
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError()
    payload = json.loads(data.decode('utf-8'))
    if set(payload) != {'format', 'sources'} or payload['format'] != 'opencost-python-input-1':
        raise ValueError()
    sources = payload['sources']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 64 or any(not isinstance(s, str) or len(s.encode('utf8')) > 1048576 for s in sources):
        raise ValueError()
    if sum(len(s.encode('utf8')) for s in sources) > 8388608:
        raise ValueError()
    sys.stdout.write(json.dumps(measure(sources), ensure_ascii=True, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Neither tracebacks, syntax errors nor input fragments are emitted.
        sys.stdout.write('{"format":"opencost-python-helper-1","error":"helper_unavailable"}')
        raise SystemExit(1)
