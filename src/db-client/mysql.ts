import { createHash } from 'crypto'
import { DBClientResult } from '../types'
import { DBClient } from './db'
import { logger } from '../logger'
import { Connection } from 'promise-mysql'

interface OkPacket {
  fieldCount: number
  affectedRows: number
  insertId: number
  serverStatus: number
  warningCount: number
  message: string
  protocol41: boolean
  changedRows: number
}

/**
 * MySQL table structure (minimal table required by trojan-gfw):
 *   CREATE TABLE users (
 *     id INT UNSIGNED NOT NULL,                     <- acctId
 *     password CHAR(56) NOT NULL UNIQUE,            <- key
 *     quota BIGINT NOT NULL DEFAULT -1,
 *     download BIGINT UNSIGNED NOT NULL DEFAULT 0,  <- download
 *     upload BIGINT UNSIGNED NOT NULL DEFAULT 0,    <- upload
 *     PRIMARY KEY (id),
 *     INDEX (password)
 *   );
 */
class MySQLClient extends DBClient {
  private cl: Connection

  constructor(mysqlClient: Connection) {
    super()
    this.cl = mysqlClient
  }

  public addAccount = async (
    acctId: number,
    password: string,
  ): Promise<DBClientResult> => {
    try {
      const key = createHash('sha224').update(password, 'utf8').digest('hex')
      const dup: { id: number }[] = await this.cl.query(
        'SELECT id FROM `users` WHERE `password` = ?',
        key,
      )
      if (dup.length !== 0) {
        if (dup[0].id === acctId) {
          return { acctId }
        } else {
          throw new Error('duplicate password.')
        }
      } else {
        await this.cl.query(
          'INSERT INTO `users` VALUES(?, ?, -1, 0, 0) ON DUPLICATE KEY UPDATE `password` = ?',
          [acctId, key, key],
        )
        return { acctId }
      }
    } catch (e) {
      throw new Error("Query error on 'add': " + e.message)
    }
  }

  public removeAccount = async (acctId: number): Promise<DBClientResult> => {
    try {
      const result: OkPacket = await this.cl.query(
        'DELETE FROM `users` WHERE `id`= ?',
        [acctId],
      )
      if (result.affectedRows === 1) {
        logger.debug(`Removed user: ${acctId}`)
        return { acctId }
      } else {
        throw new Error(`user id ${acctId} does not exist.`)
      }
    } catch (e) {
      throw new Error("Query error on 'del': " + e.message)
    }
  }

  public getFlow = async (): Promise<DBClientResult> => {
    try {
      const result: { acctId: number; flow: number }[] = await this.cl.query(
        'SELECT `id` AS `acctId`, (upload+download) AS `flow` FROM `users`',
      )
      logger.debug(`Flow: ${JSON.stringify(result)}`)
      return { flow: result }
    } catch (e) {
      throw new Error("Query error on 'flow': " + e.message)
    }
  }

  public disconnect = (): void => {
    this.cl.destroy()
  }
}

export { MySQLClient }