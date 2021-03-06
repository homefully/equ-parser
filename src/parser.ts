import { Item, filters } from "./lexer"
import { EQUParsingError } from "./error"

function expressionPrecedence(
    a: ExpressionOperator,
    b: ExpressionOperator
): boolean {
    const list = ["or", "and", "bundleStart", "bundleEnd"]

    return list.indexOf(a.operator) > list.indexOf(b.operator)
}

function filterPrecedence(a: FilterOperator, b: FilterOperator): boolean {
    const list = ["or", "and", "bundleStart", "bundleEnd"]

    return list.indexOf(a.operator) > list.indexOf(b.operator)
}

function parseError(msg?: any): never {
    if (typeof msg === "string") {
        throw new EQUParsingError(msg)
    }

    throw new EQUParsingError("unexpected " + JSON.stringify(msg))
}

type StateFn = ((ctx: ParserContext) => StateFn) | undefined

type FilterOperatorType = "and" | "or" | "bundleStart" | "bundleEnd"

type ExpressionType = keyof typeof filters
type ExpressionOperatorType = "and" | "or" | "bundleStart" | "bundleEnd"

type ValueType = "number" | "string" | "boolean" | "date" | "dateTime"

export type FilterOperator = {
    type: "operator"
    operator: FilterOperatorType
}

export type FilterOperand = {
    type: "operand"
    path: string
    expressions: Array<ExpressionItem>
}

export type ParseItem = FilterOperand | FilterOperator

export type ExpressionOperand = {
    type: "expressionOperand"
    expressionType: ExpressionType
    valueType: ValueType
    value: string | number | boolean | Date
}

export type ExpressionOperator = {
    type: "expressionOperator"
    operator: ExpressionOperatorType
}

export type ExpressionItem = ExpressionOperator | ExpressionOperand

class ParserContext {
    items: Array<Item>
    parsedItems: Array<ParseItem> = []

    filterOperatorStack: Array<FilterOperator> = []
    expressionOperatorStack: Array<ExpressionOperator> = []

    constructor(items: Array<Item>) {
        this.items = items
    }

    next(): Item {
        return this.items.shift() ?? parseError("expected to have more items")
    }

    pushFilterItem(item: ParseItem) {
        this.parsedItems.push(item)
    }

    pushExpressionItem(item: ExpressionItem) {
        const current = this.currentFilterOperand()

        current.expressions.push(item)
    }

    popFilterOperator(): FilterOperator | undefined {
        return this.filterOperatorStack.pop()
    }

    popExpressionOperator(): ExpressionOperator | undefined {
        return this.expressionOperatorStack.pop()
    }

    topExpressionOperator(): ExpressionOperator | undefined {
        if (this.expressionOperatorStack.length === 0) {
            return undefined
        }

        return this.expressionOperatorStack[
            this.expressionOperatorStack.length - 1
        ]
    }

    topFilterOperator(): FilterOperator | undefined {
        if (this.filterOperatorStack.length === 0) {
            return undefined
        }

        return this.filterOperatorStack[this.filterOperatorStack.length - 1]
    }

    currentFilterOperand(): FilterOperand {
        for (let i = this.parsedItems.length - 1; i >= 0; i--) {
            const item = this.parsedItems[i]
            if (item.type === "operand") {
                return item
            }
        }

        // this code is effectively unreachable. this only gets called when the
        // state is setup such that there is a FilterOperand in the output
        /* istanbul ignore next */
        parseError("expected to have a filter operand, but didn't find one")
    }
}

function parsePath(ctx: ParserContext): StateFn {
    const next = ctx.next()

    if (next.type === "bundleStart") {
        return parseFilterBundleStart
    }

    if (next.type === "path") {
        ctx.pushFilterItem({
            type: "operand",
            path: next.str,
            expressions: [],
        })

        return parseFiltersStart
    }

    parseError(next)
}

function parseFilterBundleStart(ctx: ParserContext): StateFn {
    ctx.filterOperatorStack.push({
        type: "operator",
        operator: "bundleStart",
    })

    return parsePath
}

function parseFiltersStart(ctx: ParserContext): StateFn {
    const next = ctx.next()
    if (next.type === "filtersStart") {
        return parseExpression
    }

    parseError(next)
}

function parseExpression(ctx: ParserContext): StateFn {
    const expressionType = ctx.next()

    if (expressionType.type === "bundleStart") {
        return parseExpressionBundleStart
    }

    let expressionOperator: ExpressionType = "eq"
    switch (expressionType.type) {
        case "filterCt": {
            expressionOperator = "ct"
            break
        }
        case "filterEq": {
            expressionOperator = "eq"
            break
        }
        case "filterGt": {
            expressionOperator = "gt"
            break
        }
        case "filterGte": {
            expressionOperator = "gte"
            break
        }
        case "filterLt": {
            expressionOperator = "lt"
            break
        }
        case "filterLte": {
            expressionOperator = "lte"
            break
        }
        case "filterRgx": {
            expressionOperator = "rgx"
            break
        }
        case "filterEx": {
            expressionOperator = "ex"
            break
        }
        case "filterNeq": {
            expressionOperator = "neq"
            break
        }
        default:
            parseError(expressionType)
    }

    const value = ctx.next()
    let valueType: ValueType = "string"
    switch (value.type) {
        case "string": {
            valueType = "string"
            break
        }
        case "number": {
            valueType = "number"
            break
        }
        case "boolean": {
            valueType = "boolean"
            break
        }
        case "date": {
            valueType = "date"
            break
        }
        case "dateTime": {
            valueType = "dateTime"
            break
        }
        default:
            parseError(value)
    }

    if (expressionOperator === "ex" && valueType !== "boolean") {
        parseError(
            "encountered ex operator with the value " +
                value.str +
                ", but it must be boolean"
        )
    }

    let parsedValue: number | string | boolean | Date = value.str
    if (value.type === "number") {
        parsedValue = Number(value.str)
    }
    if (value.type === "boolean") {
        switch (value.str) {
            case "true": {
                parsedValue = true
                break
            }
            case "false": {
                parsedValue = false
                break
            }
            default:
                parseError("invalid boolean: " + value.str)
        }
    }

    if (value.type === "date" || value.type === "dateTime") {
        parsedValue = new Date(value.str)
        if (isNaN(parsedValue.getTime())) {
            parseError("invalid date value: " + value.str)
        }
    }

    ctx.pushExpressionItem({
        type: "expressionOperand",
        expressionType: expressionOperator,
        valueType,
        value: parsedValue,
    })

    return parseAfterExpression
}

function parseExpressionBundleStart(ctx: ParserContext): StateFn {
    ctx.expressionOperatorStack.push({
        type: "expressionOperator",
        operator: "bundleStart",
    })

    return parseExpression
}

function parseAfterExpression(ctx: ParserContext): StateFn {
    const next = ctx.next()

    if (next.type === "filtersEnd") {
        const currentFilterOperand = ctx.currentFilterOperand()
        currentFilterOperand.expressions.push(
            ...ctx.expressionOperatorStack.reverse()
        )
        ctx.expressionOperatorStack = []

        return parseAfterFilter
    }

    if (next.type === "or" || next.type === "and") {
        const expressionOperator: ExpressionOperator = {
            type: "expressionOperator",
            operator: next.type,
        }

        let currentTopExpression = ctx.topExpressionOperator()
        while (
            currentTopExpression !== undefined &&
            expressionPrecedence(expressionOperator, currentTopExpression)
        ) {
            const top = ctx.popExpressionOperator() ?? parseError()
            ctx.pushExpressionItem(top)
            currentTopExpression = ctx.topExpressionOperator()
        }

        ctx.expressionOperatorStack.push(expressionOperator)

        return parseExpression
    }

    if (next.type === "bundleEnd") {
        let op = ctx.popExpressionOperator()
        while (op !== undefined) {
            if (op.operator === "bundleStart") {
                break
            }

            ctx.pushExpressionItem(op)
            op = ctx.popExpressionOperator()
        }
        return parseAfterExpression
    }

    parseError(next)
}

function parseAfterFilter(ctx: ParserContext): StateFn {
    const next = ctx.next()

    if (next.type === "eof") {
        ctx.parsedItems.push(...ctx.filterOperatorStack.reverse())
        ctx.filterOperatorStack = []

        return undefined
    }

    if (next.type === "and" || next.type === "or") {
        const filterOperator: FilterOperator = {
            type: "operator",
            operator: next.type,
        }

        let currentTopFilter = ctx.topFilterOperator()
        while (
            currentTopFilter !== undefined &&
            filterPrecedence(filterOperator, currentTopFilter)
        ) {
            const top = ctx.popFilterOperator() ?? parseError()
            ctx.pushFilterItem(top)
            currentTopFilter = ctx.topFilterOperator()
        }

        ctx.filterOperatorStack.push(filterOperator)

        return parsePath
    }

    if (next.type === "bundleEnd") {
        let op = ctx.popFilterOperator()
        while (op !== undefined) {
            if (op.operator === "bundleStart") {
                break
            }

            ctx.pushFilterItem(op)
            op = ctx.popFilterOperator()
        }
        return parseAfterFilter
    }

    parseError(next)
}

export function parse(items: Array<Item>): Array<ParseItem> {
    const parser = new ParserContext(items)
    let state: StateFn = parsePath
    while (state !== undefined) {
        state = state(parser)
    }

    return parser.parsedItems
}
