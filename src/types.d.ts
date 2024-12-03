/**
 * Amstrad CPC Tape to CDT Online Converter
 *
 * (c) 2024 Henri MEDOT
 *
 * This source code is licensed under the MIT License.
 * See the LICENSE file in the project root for more information.
 */

type PulseEdge = [sampleCount: number, newLevel: number];

type PulseProcessorMessage =
  | ['edges', PulseEdge[]]

type PulseProcessorCommand =
  | ['capture']
  | ['stop']

type Resolver = (edge: PulseEdge) => void
type Rejecter = (reason?: any) => void

type Block = {
  filename: string
  blockNumber: number
  isLastBlock: boolean
  fileType: number
  dataLength: number
  dataLocation: number
  isFirstBlock: boolean
  logicalLength: number
  entryAddress: number
  header: number[]
  data?: number[]
}