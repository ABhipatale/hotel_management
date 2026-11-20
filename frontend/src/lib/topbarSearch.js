import { useEffect, useState } from 'react'

/**
 * Menu and New order: on wide screens the top bar is slimmed down to the menu button, bell and profile, and the space in between
 * is a slot (#topbar-search, made by Layout) where the page puts its search box. `null` = no slot (phones keep their own search line).
 */
export function useTopbarSlot(id = 'topbar-search') {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(id)) }, [])
  return slot
}

// id 'topbar-phone': phones, New order only - the "Order for" table and the view buttons sit in the top bar line.
