import { NextResponse } from 'next/server'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data, error: null }, { status })
}

export function created<T>(data: T) {
  return NextResponse.json({ data, error: null }, { status: 201 })
}

export function err(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status })
}
